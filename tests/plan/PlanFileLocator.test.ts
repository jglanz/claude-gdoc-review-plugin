import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  PlanFileLocator,
  ReviewStateStore,
  sha256OfText,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

const TranscriptsPath = path.join(__dirname, "..", "fixtures", "transcripts"),
  WithPlanModeFile = path.join(TranscriptsPath, "with-plan-mode.jsonl"),
  WithoutPlanModeFile = path.join(TranscriptsPath, "without-plan-mode.jsonl")

describe("PlanFileLocator", () => {
  let statePath: string = null,
    locator: PlanFileLocator = null,
    store: ReviewStateStore = null

  beforeEach(async () => {
    statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("plan-")
    )
    store = await ReviewStateStore.create({ stateDirectory: statePath })
    locator = new PlanFileLocator(store)
  })

  afterEach(async () => {
    await rm(statePath, { recursive: true, force: true })
  })

  describe("planSlug", () => {
    it("keeps the readable basename and appends the path digest", () => {
      const slug = PlanFileLocator.planSlug("/tmp/plans/my-plan.md"),
        digest = sha256OfText("/tmp/plans/my-plan.md").slice(
          0,
          PlanFileLocator.SlugDigestLength
        )

      expect(slug).toBe(`my-plan-${digest}`)
      expect(PlanFileLocator.planSlug("/tmp/plans/my-plan.md")).toBe(slug)
      expect(ReviewStateStore.SafeNameExpression.test(slug)).toBe(true)
    })

    it("separates two plans that share a basename", () => {
      expect(PlanFileLocator.planSlug("/tmp/a/plan.md")).not.toBe(
        PlanFileLocator.planSlug("/tmp/b/plan.md")
      )
    })

    it("sanitises a basename that is not a safe path segment", () => {
      const slug = PlanFileLocator.planSlug("/tmp/plans/we/../odd name!.md")

      expect(slug).toMatch(/^odd-name--[0-9a-f]{8}$/)
      expect(ReviewStateStore.SafeNameExpression.test(slug)).toBe(true)
    })

    it("demands a plan file path", () => {
      expect(() => PlanFileLocator.planSlug("")).toThrow()
    })
  })

  describe("planFilePathOf", () => {
    it("reads a main-agent plan-mode attachment", () => {
      const line = JSON.stringify({
        type: PlanFileLocator.TranscriptLineType,
        attachment: {
          type: PlanFileLocator.PlanModeAttachmentType,
          isSubAgent: false,
          planFilePath: "/tmp/plans/a.md"
        }
      })

      expect(PlanFileLocator.planFilePathOf(line)).toBe("/tmp/plans/a.md")
    })

    it("ignores a sub-agent attachment, a foreign line and malformed JSON", () => {
      const subAgentLine = JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: true,
            planFilePath: "/tmp/plans/sub.md"
          }
        }),
        foreignLine = JSON.stringify({
          type: "user",
          message: { role: "user" }
        })

      expect(PlanFileLocator.planFilePathOf(subAgentLine)).toBeNull()
      expect(PlanFileLocator.planFilePathOf(foreignLine)).toBeNull()
      expect(PlanFileLocator.planFilePathOf("{ broken")).toBeNull()
    })

    it("ignores an attachment without a plan file path", () => {
      const line = JSON.stringify({
        type: PlanFileLocator.TranscriptLineType,
        attachment: {
          type: PlanFileLocator.PlanModeAttachmentType,
          isSubAgent: false
        }
      })

      expect(PlanFileLocator.planFilePathOf(line)).toBeNull()
    })
  })

  describe("locateFromTranscript", () => {
    it("keeps the last main-agent plan file and skips malformed lines", async () => {
      expect(await locator.locateFromTranscript(WithPlanModeFile)).toBe(
        "/tmp/plans/second-plan.md"
      )
    })

    it("returns null when the transcript announces no main-agent plan", async () => {
      expect(await locator.locateFromTranscript(WithoutPlanModeFile)).toBeNull()
    })

    it("skips a line too long to be a plan-mode attachment", async () => {
      const readableLine = JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: false,
            planFilePath: "/tmp/plans/readable-plan.md"
          }
        }),
        oversizedLine = JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: false,
            planFilePath: "/tmp/plans/oversized-plan.md",
            pasted: "x".repeat(PlanFileLocator.MaxLineBytes)
          }
        }),
        transcriptFile = path.join(statePath, "oversized.jsonl")

      expect(oversizedLine.length).toBeGreaterThan(PlanFileLocator.MaxLineBytes)
      await writeFile(
        transcriptFile,
        `${readableLine}\n${oversizedLine}\n`,
        "utf8"
      )

      // The oversized line is skipped, so the last plan the scan could read
      // stands — and the scan found one, so nothing fails.
      expect(await locator.locateFromTranscript(transcriptFile)).toBe(
        "/tmp/plans/readable-plan.md"
      )
    })

    it("fails when a skipped oversized line left it with nothing", async () => {
      const oversizedLine = JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: false,
            planFilePath: "/tmp/plans/oversized-plan.md",
            pasted: "x".repeat(PlanFileLocator.MaxLineBytes)
          }
        }),
        transcriptFile = path.join(statePath, "oversized-refused.jsonl")

      await writeFile(transcriptFile, `${oversizedLine}\n`, "utf8")

      // "No plan here" is a conclusion the scan may not draw once it refused to
      // read part of the transcript: the gate must deny rather than wave the
      // plan through.
      await expect(
        locator.locateFromTranscript(transcriptFile)
      ).rejects.toThrow(
        PlanFileLocator.newSkippedLinesMessage(transcriptFile, 1)
      )
    })

    it("still reads a plan-mode attachment inside the line budget", async () => {
      const planFile = "/tmp/plans/large-but-fine.md",
        line = JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: false,
            planFilePath: planFile
          }
        }),
        transcriptFile = path.join(statePath, "within-budget.jsonl")

      await writeFile(transcriptFile, `${line}\n`, "utf8")

      expect(await locator.locateFromTranscript(transcriptFile)).toBe(planFile)
    })

    it("still fails through locate, which every hook goes through", async () => {
      const oversizedLine = JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: false,
            planFilePath: "/tmp/plans/oversized-plan.md",
            pasted: "x".repeat(PlanFileLocator.MaxLineBytes)
          }
        }),
        transcriptFile = path.join(statePath, "oversized-locate.jsonl")

      await writeFile(transcriptFile, `${oversizedLine}\n`, "utf8")

      await expect(
        locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-oversized"
        })
      ).rejects.toThrow(
        PlanFileLocator.newSkippedLinesMessage(transcriptFile, 1)
      )
    })

    it("returns null for a missing or unnamed transcript", async () => {
      expect(
        await locator.locateFromTranscript(path.join(statePath, "absent.jsonl"))
      ).toBeNull()
      expect(await locator.locateFromTranscript("")).toBeNull()
    })
  })

  describe("isCacheOf", () => {
    it("accepts only a record stamped with exactly these transcript stats", async () => {
      const transcriptFile = path.join(statePath, "stats.jsonl")

      await writeFile(transcriptFile, "{}\n", "utf8")

      const stats = await stat(transcriptFile),
        record = {
          planFile: "/tmp/plans/a.md",
          transcriptMtimeMs: stats.mtimeMs,
          transcriptSize: stats.size
        }

      expect(PlanFileLocator.isCacheOf(record, stats)).toBe(true)
      expect(
        PlanFileLocator.isCacheOf(
          { ...record, transcriptMtimeMs: stats.mtimeMs + 1 },
          stats
        )
      ).toBe(false)
      expect(
        PlanFileLocator.isCacheOf(
          { ...record, transcriptSize: stats.size + 1 },
          stats
        )
      ).toBe(false)
    })

    it("refuses a missing record and missing transcript stats", async () => {
      const transcriptFile = path.join(statePath, "stats-null.jsonl")

      await writeFile(transcriptFile, "{}\n", "utf8")

      const stats = await stat(transcriptFile),
        record = {
          planFile: "/tmp/plans/a.md",
          transcriptMtimeMs: stats.mtimeMs,
          transcriptSize: stats.size
        }

      expect(PlanFileLocator.isCacheOf(null, stats)).toBe(false)
      expect(PlanFileLocator.isCacheOf(record, null)).toBe(false)
      expect(PlanFileLocator.isCacheOf(null, null)).toBe(false)
    })
  })

  describe("locate", () => {
    let recordedPlanFile: string = null,
      transcriptFile: string = null

    async function writeTranscript(planFile: string): Promise<void> {
      await writeFile(
        transcriptFile,
        `${JSON.stringify({
          type: PlanFileLocator.TranscriptLineType,
          attachment: {
            type: PlanFileLocator.PlanModeAttachmentType,
            isSubAgent: false,
            planFilePath: planFile
          }
        })}\n`,
        "utf8"
      )
    }

    async function rememberScan(
      sessionId: string,
      planFile: string
    ): Promise<void> {
      const stats = await stat(transcriptFile)

      await store.writeSessionPlanRecord(sessionId, {
        planFile,
        transcriptMtimeMs: stats.mtimeMs,
        transcriptSize: stats.size
      })
    }

    beforeEach(async () => {
      recordedPlanFile = path.join(statePath, "recorded-plan.md")
      transcriptFile = path.join(statePath, "session.jsonl")
      await writeFile(recordedPlanFile, "# Recorded\n", "utf8")
    })

    it("prefers an explicit plan file", async () => {
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", recordedPlanFile)

      const planFile = await locator.locate({
        explicitPlanFile: "/tmp/plans/explicit.md",
        transcriptPath: transcriptFile,
        sessionId: "session-1"
      })

      expect(planFile).toBe("/tmp/plans/explicit.md")
    })

    it("prefers the transcript over a sessions entry naming another plan", async () => {
      const cachedPlanFile = path.join(statePath, "cached-plan.md")

      await writeFile(cachedPlanFile, "# Cached\n", "utf8")
      await writeTranscript(recordedPlanFile)
      await store.writeSessionPlanRecord("session-1", {
        planFile: cachedPlanFile,
        transcriptMtimeMs: 1,
        transcriptSize: 1
      })

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(recordedPlanFile)
    })

    it("skips the scan while the transcript's size and mtime are unchanged", async () => {
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", recordedPlanFile)

      const scan = jest.spyOn(locator, "locateFromTranscript")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(recordedPlanFile)
      expect(scan).not.toHaveBeenCalled()

      scan.mockRestore()
    })

    it("rescans when the cached transcript stats are stale", async () => {
      const cachedPlanFile = path.join(statePath, "cached-plan.md")

      await writeFile(cachedPlanFile, "# Cached\n", "utf8")
      await writeTranscript(recordedPlanFile)
      await store.writeSessionPlanRecord("session-1", {
        planFile: cachedPlanFile,
        transcriptMtimeMs: 1,
        transcriptSize: 1
      })

      const scan = jest.spyOn(locator, "locateFromTranscript")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(recordedPlanFile)
      expect(scan).toHaveBeenCalledWith(transcriptFile)
      await expect(
        store.readSessionPlanRecord("session-1")
      ).resolves.toMatchObject({ planFile: recordedPlanFile })

      scan.mockRestore()
    })

    it("rescans a transcript rewritten to the same length", async () => {
      const otherPlanFile = path.join(statePath, "other-plan.md")

      await writeFile(otherPlanFile, "# Other\n", "utf8")
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", recordedPlanFile)

      const before = await stat(transcriptFile)

      // Same byte count, different plan: only the modification time separates
      // the two transcripts, so the stamp has to carry it.
      await writeTranscript(otherPlanFile.padEnd(recordedPlanFile.length, "x"))
      await utimes(
        transcriptFile,
        before.atime,
        new Date(before.mtimeMs + 2_000)
      )

      const after = await stat(transcriptFile)
      expect(after.size).toBe(before.size)
      expect(after.mtimeMs).not.toBe(before.mtimeMs)

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(otherPlanFile.padEnd(recordedPlanFile.length, "x"))
    })

    it("returns the cached plan of an unchanged transcript, whatever it names", async () => {
      const cachedPlanFile = path.join(statePath, "cached-plan.md")

      await writeFile(cachedPlanFile, "# Cached\n", "utf8")
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", cachedPlanFile)

      const scan = jest.spyOn(locator, "locateFromTranscript")

      // The stamp matches, so the entry is the answer and the transcript is
      // not read at all — which is exactly what makes the stamp load-bearing.
      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(cachedPlanFile)
      expect(scan).not.toHaveBeenCalled()

      scan.mockRestore()
    })

    it("re-stamps the entry when a compacted transcript names no plan", async () => {
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", recordedPlanFile)
      await writeFile(transcriptFile, "{}\n", "utf8")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(recordedPlanFile)

      const stats = await stat(transcriptFile)

      await expect(store.readSessionPlanRecord("session-1")).resolves.toEqual({
        planFile: recordedPlanFile,
        transcriptMtimeMs: stats.mtimeMs,
        transcriptSize: stats.size
      })

      const scan = jest.spyOn(locator, "locateFromTranscript")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(recordedPlanFile)
      expect(scan).not.toHaveBeenCalled()

      scan.mockRestore()
    })

    it("treats a legacy bare-path sessions entry as no entry", async () => {
      await writeFile(transcriptFile, "", "utf8")
      await writeFileAtomic(store.sessionFile("session-1"), recordedPlanFile)

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBeNull()
    })

    it("falls back to the cached entry once the transcript names no plan", async () => {
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", recordedPlanFile)
      await writeFile(transcriptFile, "{}\n", "utf8")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBe(recordedPlanFile)
    })

    it("ignores a cached entry whose plan file is gone", async () => {
      await writeTranscript(recordedPlanFile)
      await rememberScan("session-1", recordedPlanFile)
      await rm(recordedPlanFile, { force: true })
      await writeFile(transcriptFile, "{}\n", "utf8")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-1"
        })
      ).toBeNull()
    })

    it("caches a plan found by scanning, so the next call skips the scan", async () => {
      await writeTranscript(recordedPlanFile)

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-2"
        })
      ).toBe(recordedPlanFile)
      await expect(
        store.readSessionPlanRecord("session-2")
      ).resolves.toMatchObject({ planFile: recordedPlanFile })

      const scan = jest.spyOn(locator, "locateFromTranscript")

      expect(
        await locator.locate({
          transcriptPath: transcriptFile,
          sessionId: "session-2"
        })
      ).toBe(recordedPlanFile)
      expect(scan).not.toHaveBeenCalled()

      scan.mockRestore()
    })

    it("does not cache when the caller named no session", async () => {
      expect(await locator.locate({ transcriptPath: WithPlanModeFile })).toBe(
        "/tmp/plans/second-plan.md"
      )
      await expect(
        readdir(path.join(statePath, ReviewStateStore.SessionsSubpath))
      ).resolves.toEqual([])
    })

    it("returns null when no source knows a plan file", async () => {
      expect(await locator.locate({ sessionId: "unknown-session" })).toBeNull()
      expect(await locator.locate({})).toBeNull()
    })
  })
})
