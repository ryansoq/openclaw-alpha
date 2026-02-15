/**
 * PR Board — fetches open PRs from GitHub and caches them.
 *
 * Uses `gh` CLI to query the repo's pull requests.
 * Marks PRs with no activity for >24h as "stalled".
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  url: string;
  status: "open" | "review" | "approved" | "changes-requested" | "draft";
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
  stalled: boolean;  // no activity >24h
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class PRBoard {
  private cached: PullRequest[] = [];
  private lastFetch = 0;
  private fetching = false;
  private repo: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(repo: string) {
    this.repo = repo;
  }

  /** Start periodic background refresh */
  start(): void {
    this.refresh(); // initial fetch
    this.timer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Get cached PRs (returns immediately) */
  list(): PullRequest[] {
    return this.cached;
  }

  /** Force a refresh */
  async refresh(): Promise<PullRequest[]> {
    if (this.fetching) return this.cached;
    this.fetching = true;
    try {
      const { stdout } = await execFileAsync("gh", [
        "pr", "list",
        "--repo", this.repo,
        "--state", "open",
        "--json", "number,title,author,url,reviewRequests,reviews,createdAt,updatedAt,isDraft",
        "--limit", "30",
      ], { timeout: 15000 });

      const raw = JSON.parse(stdout) as any[];
      const now = Date.now();

      this.cached = raw.map((pr): PullRequest => {
        const reviewers = [
          ...(pr.reviewRequests ?? []).map((r: any) => r.login ?? r.name ?? "unknown"),
          ...(pr.reviews ?? []).map((r: any) => r.author?.login ?? "unknown"),
        ];
        // Deduplicate
        const uniqueReviewers = [...new Set(reviewers)];

        // Determine status from reviews
        let status: PullRequest["status"] = "open";
        if (pr.isDraft) {
          status = "draft";
        } else if (pr.reviews?.length) {
          const lastReview = pr.reviews[pr.reviews.length - 1];
          if (lastReview.state === "APPROVED") status = "approved";
          else if (lastReview.state === "CHANGES_REQUESTED") status = "changes-requested";
          else status = "review";
        } else if (pr.reviewRequests?.length) {
          status = "review";
        }

        const updatedMs = new Date(pr.updatedAt).getTime();
        const stalled = (now - updatedMs) > STALE_THRESHOLD_MS;

        return {
          number: pr.number,
          title: pr.title,
          author: pr.author?.login ?? "unknown",
          url: pr.url,
          status,
          reviewers: uniqueReviewers,
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
          stalled,
        };
      });

      this.lastFetch = now;
    } catch (err) {
      console.error("[PRBoard] Failed to fetch PRs:", (err as Error).message);
    } finally {
      this.fetching = false;
    }
    return this.cached;
  }
}
