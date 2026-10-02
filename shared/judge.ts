/**
 * Judge seam (hosted). The worker speaks jev's native TypeSafe shape directly:
 * POST { state, model, questions } with Bearer auth to DABLOONS_JUDGE_URL,
 * read p(pass) from answers.passes.noul. No adapter service in between.
 */

export interface JudgeInput {
  id: number;
  poster: string;
  worker: string;
  title: string;
  requirements: string;
  price: number;
  quality: string;
  result: string;
  /** The worker's proof, separate from the result; required on report kinds. */
  evidence: string | null;
  submitted_at: string;
  deadline: string | null;
}

export interface JevJudgeConfig {
  url: string;
  apiKey: string;
}

/** On custom jobs, p(pass) at or above this auto-releases escrow; below waits for the poster or an admin. Advisory on report kinds. */
export const JEV_AUTO_RELEASE_THRESHOLD = 0.95;

const JEV_MODEL = "jev-latest";
const JEV_QUESTION_ID = "passes";

function jevRequestBody(job: JudgeInput) {
  // With evidence, the claims must be backed by it. Without (custom jobs may omit it), the criteria stay as before.
  const backed = job.evidence ? ", and every claim it makes is backed by the evidence" : "";
  const unbacked = job.evidence ? ", or makes a claim the evidence does not back" : "";
  return {
    state: {
      job_title: job.title,
      requirements: job.requirements,
      quality_criteria: job.quality,
      submission: job.result,
      ...(job.evidence ? { evidence: job.evidence } : {}),
      submitted_at: job.submitted_at,
      deadline: job.deadline,
    },
    model: JEV_MODEL,
    questions: {
      [JEV_QUESTION_ID]: {
        type: "noul",
        instructions: "Does the submission satisfy the job's quality criteria?",
        criteria: {
          true: `The submission meets every element of the stated quality criteria${backed}.`,
          false: `The submission fails at least one element of the stated quality criteria${unbacked}.`,
        },
      },
    },
  };
}

export interface JevScore {
  /** P(submission passes), 0..1, in jev's native response shape. */
  score: number;
  model: string;
}

export async function runJudgeViaJev(
  job: JudgeInput,
  cfg: JevJudgeConfig,
  timeoutMs = 15000
): Promise<JevScore> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(jevRequestBody(job)),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`jev returned HTTP ${res.status}`);
    const data: any = await res.json();
    const score = data?.answers?.[JEV_QUESTION_ID]?.noul;
    if (typeof score !== "number" || !(score >= 0 && score <= 1)) {
      throw new Error("jev response has no answers.passes.noul probability");
    }
    return { score, model: data?.model ?? JEV_MODEL };
  } finally {
    clearTimeout(timer);
  }
}
