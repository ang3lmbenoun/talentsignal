// S-25 Candidates redesign: "why this candidate matches" needs a real
// match target. `opportunities` (the ATS-scraped hidden-demand rows) have
// no structured skill-requirements field at all -- the only real,
// structured requirements list in this app lives on `job_openings`
// (backend/src/matching/matchScore.ts + matchConfig.ts, weights.skills=0.7
// / weights.experience=0.3, 10yr saturation, Ali-prescribed cosine method,
// 06_decisions/011). This module ports that exact algorithm client-side so
// candidate cards can show a real best-matched job opening instead of
// inventing an opportunity-level match that has no underlying data.

export interface MatchCandidateInput {
  skills: string[];
  experience: number | null;
}

export interface MatchJobInput {
  id: string;
  title: string;
  requirements: string[];
}

export interface MatchResult {
  fitScore: number;
  matchedSkills: string[];
}

const WEIGHTS = { skills: 0.7, experience: 0.3 };
const EXPERIENCE_SATURATION_YEARS = 10;

function normalize(term: string): string {
  return term.trim().toLowerCase();
}

function toNormalizedSet(terms: string[]): Set<string> {
  return new Set(terms.map(normalize).filter((term) => term.length > 0));
}

// Exact port of backend/src/matching/matchScore.ts's scoreCandidate --
// same cosine-similarity formula, same weights, same saturation constant.
export function scoreCandidateAgainstJob(candidate: MatchCandidateInput, job: MatchJobInput): MatchResult {
  const candidateSkills = toNormalizedSet(candidate.skills);
  const requirements = toNormalizedSet(job.requirements);

  const originalCasing = new Map<string, string>();
  for (const skill of candidate.skills) {
    const key = normalize(skill);
    if (key.length > 0 && !originalCasing.has(key)) originalCasing.set(key, skill);
  }

  const matchedKeys = [...candidateSkills].filter((skill) => requirements.has(skill));
  const matchedSkills = matchedKeys.map((key) => originalCasing.get(key) ?? key);

  const skillsScore =
    candidateSkills.size === 0 || requirements.size === 0
      ? 0
      : matchedKeys.length / Math.sqrt(candidateSkills.size * requirements.size);

  const experienceYears = candidate.experience ?? 0;
  const experienceScore = Math.min(experienceYears, EXPERIENCE_SATURATION_YEARS) / EXPERIENCE_SATURATION_YEARS;

  const fitScore = skillsScore * WEIGHTS.skills + skillsScore * WEIGHTS.experience * experienceScore;

  return { fitScore: Math.round(fitScore * 1000) / 1000, matchedSkills };
}

export interface BestMatch {
  job: MatchJobInput;
  result: MatchResult;
}

// Highest fitScore among all loaded job openings; ties broken by job id for
// determinism (same reasoning as the backend's byFitScoreThenId). Returns
// undefined only when there are no job openings loaded at all -- a real
// zero-overlap match still returns a BestMatch (fitScore 0), since that's
// real information ("no overlap with this specific job"), not an absence
// of one.
export function bestMatchForCandidate(candidate: MatchCandidateInput, jobs: MatchJobInput[]): BestMatch | undefined {
  let best: BestMatch | undefined;
  for (const job of jobs) {
    const result = scoreCandidateAgainstJob(candidate, job);
    if (!best || result.fitScore > best.result.fitScore || (result.fitScore === best.result.fitScore && job.id < best.job.id)) {
      best = { job, result };
    }
  }
  return best;
}
