import { mkdtemp, readdir, rm } from "node:fs/promises"
import path from "node:path"

import {
  createInitialReviewState,
  createReviewStateStoreDefaultOptions,
  DriveKind,
  GDocReview,
  NestedError,
  PluginConfig,
  PlanFileLocator,
  ReviewState,
  ReviewStateStore,
  ReviewStatus,
  ReviewTarget,
  SessionPlanRecord,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

const PersonalTarget: ReviewTarget = {
  kind: DriveKind.personal,
  driveName: null,
  driveId: null,
  path: "code/claude/wip/MyPlan",
  folderId: "1FolderIdAbCdEfGhIjKlMnOpQrStUvWxYz01234"
}

function slugOf(planFile: string): string {
  return PlanFileLocator.planSlug(planFile)
}

function createState(planFile: string): ReviewState {
  return createInitialReviewState({
    planFile,
    target: PersonalTarget
  })
}

describe("ReviewStateStore", () => {
  const originalEnvironment = { ...process.env }

  let statePath: string = null,
    store: ReviewStateStore = null

  beforeEach(async () => {
    statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("store-")
    )
    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] = statePath
    store = await ReviewStateStore.create({ stateDirectory: statePath })
  })

  afterEach(async () => {
    process.env = { ...originalEnvironment }
    await rm(statePath, { recursive: true, force: true })
  })

  describe("create", () => {
    it("ensures the reviews and sessions sub-directories", async () => {
      expect((await readdir(statePath)).sort()).toEqual([
        ReviewStateStore.ReviewsSubpath,
        ReviewStateStore.SessionsSubpath
      ])
    })

    it("defaults the state directory to the resolved one", () => {
      expect(createReviewStateStoreDefaultOptions()).toEqual({
        stateDirectory: path.join(statePath, GDocReview.StateDirName)
      })
    })
  })

  describe("reviewFile", () => {
    it("places the document under reviews/ with a json extension", () => {
      expect(store.reviewFile("my-plan")).toBe(
        path.join(statePath, ReviewStateStore.ReviewsSubpath, "my-plan.json")
      )
    })

    it("refuses a name that would escape the state directory", () => {
      expect(() => store.reviewFile("..")).toThrow()
      expect(() => store.reviewFile("../../etc/passwd")).toThrow()
      expect(() => store.reviewFile("")).toThrow()
    })
  })

  describe("load and save", () => {
    it("round-trips a review keyed by its plan file", async () => {
      const state = createState("/tmp/plans/my-plan.md")
      await store.save(state)

      expect(await store.load(slugOf("/tmp/plans/my-plan.md"))).toEqual(state)
    })

    it("leaves no temporary file behind", async () => {
      await store.save(createState("/tmp/plans/my-plan.md"))

      expect(
        await readdir(path.join(statePath, ReviewStateStore.ReviewsSubpath))
      ).toEqual([
        `${slugOf("/tmp/plans/my-plan.md")}${ReviewStateStore.ReviewFileExtension}`
      ])
    })

    it("returns null for a review that does not exist", async () => {
      expect(await store.load("never-created")).toBeNull()
    })

    it("refuses to save a state without a plan file", async () => {
      const state = createState("/tmp/plans/my-plan.md")

      await expect(store.save({ ...state, planFile: "" })).rejects.toThrow()
    })

    it("refuses to load a corrupted document", async () => {
      await writeFileAtomic(store.reviewFile("corrupted"), "{ broken")

      await expect(store.load("corrupted")).rejects.toBeInstanceOf(NestedError)
    })
  })

  describe("the sessions map", () => {
    const record: SessionPlanRecord = {
      planFile: "/tmp/plans/my-plan.md",
      transcriptMtimeMs: 1_700_000_000_000,
      transcriptSize: 4_096
    }

    it("round-trips the cached transcript scan of a session", async () => {
      await store.writeSessionPlanRecord("session-abc", record)

      expect(await store.readSessionPlanRecord("session-abc")).toEqual(record)
    })

    it("returns null for an unknown session", async () => {
      expect(await store.readSessionPlanRecord("session-unknown")).toBeNull()
    })

    it("treats a legacy bare-path entry as no entry at all", async () => {
      await writeFileAtomic(
        store.sessionFile("session-legacy"),
        "/tmp/plans/my-plan.md"
      )

      expect(await store.readSessionPlanRecord("session-legacy")).toBeNull()
    })

    it("refuses an unsafe session id or a record with no plan file", async () => {
      await expect(
        store.writeSessionPlanRecord("../escape", record)
      ).rejects.toThrow()
      await expect(
        store.writeSessionPlanRecord("session-abc", {
          ...record,
          planFile: ""
        })
      ).rejects.toThrow()
      await expect(
        store.writeSessionPlanRecord("session-abc", null)
      ).rejects.toThrow()
    })
  })

  describe("listActive", () => {
    it("returns only active reviews and skips unreadable documents", async () => {
      const active = {
          ...createState("/tmp/plans/active.md"),
          status: ReviewStatus.active
        },
        approved = {
          ...createState("/tmp/plans/approved.md"),
          status: ReviewStatus.approved
        }

      await store.save(active)
      await store.save(approved)
      await writeFileAtomic(store.reviewFile("corrupted"), "{ broken")

      const listed = await store.listActive()

      expect(listed.map(state => state.planFile)).toEqual([
        "/tmp/plans/active.md"
      ])
    })

    it("is empty on a fresh state directory", async () => {
      expect(await store.listActive()).toEqual([])
    })
  })

  describe("assertSafeName", () => {
    it("accepts a plain slug and rejects traversal or separators", () => {
      expect(ReviewStateStore.assertSafeName("my-plan_2.v1")).toBe(
        "my-plan_2.v1"
      )
      expect(() => ReviewStateStore.assertSafeName(".")).toThrow()
      expect(() => ReviewStateStore.assertSafeName("..")).toThrow()
      expect(() => ReviewStateStore.assertSafeName("a/b")).toThrow()
      expect(() => ReviewStateStore.assertSafeName(null)).toThrow()
    })
  })
})
