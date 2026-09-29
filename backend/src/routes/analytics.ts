import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";

interface PlacementsRow {
  month: string;
  count: number;
}

interface TimeToHireRow {
  average_days: string | null;
  sample_size: number;
}

interface DemandScoreRow {
  average: string | null;
  sample_size: number;
}

interface TimeToHirePerMonthRow {
  month: string;
  average_days: string;
  sample_size: number;
}

interface TopClientRow {
  client_id: string;
  client_name: string;
  count: number;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Computed on the fly from sales_pipeline_audit (S-08) and opportunities
 * (S-04) — no Analytics snapshot table (06_decisions/020, a deliberate
 * deviation from Ali's build note, flagged for his review). Every query here
 * reads only audit rows and opportunity aggregates; neither candidates nor
 * clients is ever touched, so there is no PII surface to accidentally leak —
 * proven by analytics.pii.integration.test.ts against the pii_fields
 * registry itself.
 */
export function analyticsRouter(pool: Pool): Router {
  const router = Router();

  router.get("/analytics", requireAuth, async (req, res) => {
    try {
      const [placementsResult, timeToHireResult, demandScoreResult, timeToHirePerMonthResult, topClientsResult] = await Promise.all([
        // Placements per month = every transition TO 'closed', grouped by
        // when it happened (06_decisions/020) — an event log reading, not a
        // snapshot of who's currently closed. A client that closes, reopens,
        // and closes again counts twice, once per real closing.
        pool.query(
          `SELECT to_char(changed_at, 'YYYY-MM') AS month, count(*)::int AS count
           FROM sales_pipeline_audit
           WHERE to_stage = 'closed'
           GROUP BY month
           ORDER BY month`,
        ),
        // Time-to-hire = each client's FIRST-ever audit row (entered the
        // pipeline) to each 'closed' row, averaged in days across every
        // placement event above.
        pool.query(
          `WITH first_events AS (
             SELECT DISTINCT ON (client_id) client_id, changed_at AS first_at
             FROM sales_pipeline_audit
             ORDER BY client_id, changed_at ASC
           ), closed_events AS (
             SELECT client_id, changed_at AS closed_at
             FROM sales_pipeline_audit
             WHERE to_stage = 'closed'
           )
           SELECT avg(extract(epoch FROM (ce.closed_at - fe.first_at)) / 86400.0) AS average_days,
                  count(*)::int AS sample_size
           FROM closed_events ce JOIN first_events fe USING (client_id)`,
        ),
        // Demand score = average confidence_score across opportunities,
        // excluding seed-job-board rows by default — same convention as
        // hiddenDemand.ts's includeSeedData filter.
        pool.query(
          `SELECT avg(confidence_score) AS average, count(*)::int AS sample_size
           FROM opportunities WHERE source != 'seed-job-board'`,
        ),
        // S-25: per-month time-to-hire for the redesigned combo chart's
        // line series -- same definition and CTEs as the overall
        // time-to-hire KPI above (decision 020), just grouped by the month
        // of the closing event instead of averaged across all of them. Not
        // a new business decision, only a finer grouping of an
        // already-defined metric.
        pool.query(
          `WITH first_events AS (
             SELECT DISTINCT ON (client_id) client_id, changed_at AS first_at
             FROM sales_pipeline_audit
             ORDER BY client_id, changed_at ASC
           ), closed_events AS (
             SELECT client_id, changed_at AS closed_at
             FROM sales_pipeline_audit
             WHERE to_stage = 'closed'
           )
           SELECT to_char(ce.closed_at, 'YYYY-MM') AS month,
                  avg(extract(epoch FROM (ce.closed_at - fe.first_at)) / 86400.0) AS average_days,
                  count(*)::int AS sample_size
           FROM closed_events ce JOIN first_events fe USING (client_id)
           GROUP BY month
           ORDER BY month`,
        ),
        // S-25: top 10 clients by real placement count (same event-based
        // placement definition as placementsPerMonth above), for the new
        // client contribution panel.
        pool.query(
          `SELECT c.id AS client_id, c.name AS client_name, count(*)::int AS count
           FROM sales_pipeline_audit spa
           JOIN clients c ON c.id = spa.client_id
           WHERE spa.to_stage = 'closed'
           GROUP BY c.id, c.name
           ORDER BY count DESC
           LIMIT 10`,
        ),
      ]);

      const timeToHireRow = timeToHireResult.rows[0] as TimeToHireRow;
      const demandScoreRow = demandScoreResult.rows[0] as DemandScoreRow;

      logger.info({ correlationId: req.correlationId }, "analytics KPIs computed");
      res.status(200).json({
        placementsPerMonth: (placementsResult.rows as PlacementsRow[]).map((row) => ({
          month: row.month,
          count: row.count,
        })),
        timeToHire: {
          averageDays: timeToHireRow.average_days === null ? null : round(Number(timeToHireRow.average_days), 1),
          sampleSize: timeToHireRow.sample_size,
        },
        demandScore: {
          average: demandScoreRow.average === null ? null : round(Number(demandScoreRow.average), 3),
          sampleSize: demandScoreRow.sample_size,
        },
        timeToHirePerMonth: (timeToHirePerMonthResult.rows as TimeToHirePerMonthRow[]).map((row) => ({
          month: row.month,
          averageDays: round(Number(row.average_days), 1),
          sampleSize: row.sample_size,
        })),
        topClientsByPlacements: (topClientsResult.rows as TopClientRow[]).map((row) => ({
          clientId: row.client_id,
          clientName: row.client_name,
          count: row.count,
        })),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "analytics KPI computation failed");
      res.status(500).json({ error: "failed to compute analytics" });
    }
  });

  return router;
}
