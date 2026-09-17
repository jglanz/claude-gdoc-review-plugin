import {
  CommentAction,
  createInitialReviewState,
  DriveKind,
  NestedError,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewState,
  ReviewStateCodec,
  ReviewStateText,
  ReviewStatus,
  ReviewTarget,
  SyncMode
} from "claude-gdoc-review-plugin"

const SharedTarget: ReviewTarget = {
  kind: DriveKind.shared,
  driveName: "Engineering",
  driveId: "0ASharedDriveIdAbCdEfGhIjKl",
  path: "design/plans/MySpecialPlan",
  folderId: "1FolderIdAbCdEfGhIjKlMnOpQrStUvWxYz01"
}

function createState(): ReviewState {
  return createInitialReviewState({
    planFile: "/tmp/plans/my-special-plan.md",
    target: SharedTarget
  })
}

describe("ReviewState", () => {
  describe("createInitialReviewState", () => {
    it("starts a review in setup with nothing synced", () => {
      const state = createState()

      expect(state.version).toBe(ReviewState.Version)
      expect(state.status).toBe(ReviewStatus.setup)
      expect(state.planFile).toBe("/tmp/plans/my-special-plan.md")
      expect(state.target).toEqual(SharedTarget)
      expect(state.syncMode).toBe(SyncMode.content)
      expect(state.revision).toBe(ReviewState.InitialRevision)
      expect(state.doc).toBeNull()
      expect(state.logCommentId).toBeNull()
      expect(state.lastSync).toBeNull()
      expect(state.decision).toBeNull()
      expect(state.comments).toEqual({})
      expect(state.approvedAt).toBeNull()
      expect(state.approvedMode).toBeNull()
      expect(Date.parse(state.createdAt)).not.toBeNaN()
    })

    it("honours an explicit sync mode", () => {
      const state = createInitialReviewState({
        planFile: "/tmp/plans/p.md",
        target: SharedTarget,
        syncMode: SyncMode.file_path
      })

      expect(state.syncMode).toBe(SyncMode.file_path)
    })

    it("demands a plan file and a target", () => {
      expect(() =>
        createInitialReviewState({
          planFile: "",
          target: SharedTarget
        })
      ).toThrow()
      expect(() =>
        createInitialReviewState({
          planFile: "/tmp/p.md",
          target: null
        })
      ).toThrow()
    })
  })

  describe("ReviewStateCodec", () => {
    it("round-trips a state through JSON", () => {
      const state = createState()

      expect(ReviewStateCodec.parse(ReviewStateCodec.serialize(state))).toEqual(
        state
      )
    })

    it("pretty-prints so the file stays readable while debugging", () => {
      expect(ReviewStateCodec.serialize(createState())).toContain(
        '\n  "version": 1'
      )
    })

    it("rejects text that is not JSON", () => {
      expect(() => ReviewStateCodec.parse("{ broken")).toThrow(NestedError)
    })

    it("demands text", () => {
      expect(() => ReviewStateCodec.parse("")).toThrow()
    })

    it("rejects a document missing a required field", () => {
      const { planFile: _planFile, ...incomplete } = createState()

      expect(() => ReviewStateCodec.parse(JSON.stringify(incomplete))).toThrow(
        NestedError
      )
    })

    it("rejects an unknown status on the way in and on the way out", () => {
      const state = createState(),
        corrupted = { ...state, status: "abandoned" }

      expect(() => ReviewStateCodec.parse(JSON.stringify(corrupted))).toThrow(
        NestedError
      )
      expect(() =>
        ReviewStateCodec.serialize(corrupted as ReviewState)
      ).toThrow(NestedError)
    })

    it("drops the retired target keys of an older document", () => {
      const state = createState(),
        older = {
          ...state,
          target: {
            ...state.target,
            createdFolderIds: ["folder-a"],
            knownFolderIds: ["folder-b"],
            observedIds: ["folder-c"]
          }
        },
        parsed = ReviewStateCodec.parse(JSON.stringify(older))

      // They recorded the Drive parents a setup-phase write gate trusted. That
      // gate is gone, so the keys grant nothing and are discarded rather than
      // carried forward.
      ReviewState.RetiredTargetKeys.forEach(key =>
        expect(parsed.target).not.toHaveProperty(key)
      )
      expect(parsed.target).toEqual(state.target)
    })

    it("round-trips a decision with its provenance and single-use stamp", () => {
      const state = createState(),
        decided = {
          ...state,
          decision: {
            choice: ReviewDecisionChoice.approve_auto,
            label: "Approve and Use Auto Mode",
            text: null,
            planSha256: "a".repeat(64),
            at: "2026-09-16T14:02:00.000Z",
            source: ReviewDecisionSource.ask_user_question,
            toolUseId: "toolu_menu_1",
            consumedAt: "2026-09-16T14:03:00.000Z"
          }
        }

      expect(ReviewStateCodec.parse(JSON.stringify(decided)).decision).toEqual(
        decided.decision
      )
    })

    it("rejects a decision with no source and one with an unknown source", () => {
      const state = createState(),
        decision = {
          choice: ReviewDecisionChoice.approve_auto,
          label: "Approve and Use Auto Mode",
          text: null,
          planSha256: "a".repeat(64),
          at: "2026-09-16T14:02:00.000Z",
          toolUseId: null,
          consumedAt: null
        }

      expect(() =>
        ReviewStateCodec.parse(JSON.stringify({ ...state, decision }))
      ).toThrow(NestedError)
      expect(() =>
        ReviewStateCodec.parse(
          JSON.stringify({
            ...state,
            decision: { ...decision, source: "the_model" }
          })
        )
      ).toThrow(NestedError)
    })

    it("rejects a Doc with no MCP server recorded on it", () => {
      const state = createState(),
        { serverName: _serverName, ...doc } = {
          id: "1DocIdAbCdEfGhIjKlMnOpQrStUvWxYz012345",
          url: "https://docs.google.com/document/d/1DocIdAbCdEfGhIjKlMnOpQrStUvWxYz012345/edit",
          title: "MySpecialPlan",
          serverName: "gworkspace-personal"
        }

      expect(() =>
        ReviewStateCodec.parse(JSON.stringify({ ...state, doc }))
      ).toThrow(NestedError)
    })

    it("rejects stored text that carries a control character", () => {
      const state = createState()

      expect(() =>
        ReviewStateCodec.parse(
          JSON.stringify({
            ...state,
            target: { ...state.target, path: "design/\u001b[2Jplans/X" }
          })
        )
      ).toThrow(NestedError)
    })

    it("rejects stored text longer than the recorded cap", () => {
      const state = createState()

      expect(() =>
        ReviewStateCodec.parse(
          JSON.stringify({
            ...state,
            target: {
              ...state.target,
              path: "a".repeat(ReviewStateText.MaxPathLength + 1)
            }
          })
        )
      ).toThrow(NestedError)
    })

    it("rejects a comment id that is not one", () => {
      const state = createState()

      expect(() =>
        ReviewStateCodec.parse(
          JSON.stringify({ ...state, logCommentId: "AAAAA?!/.." })
        )
      ).toThrow(NestedError)
    })

    it("rejects more comment records than a review keeps", () => {
      const state = createState(),
        comments = Object.fromEntries(
          Array.from(
            { length: ReviewStateText.MaxComments + 1 },
            (_unused, index) => [
              `comment-${index}`,
              {
                lastAction: "reply",
                revision: 1,
                at: "2026-09-16T14:02:00.000Z"
              }
            ]
          )
        )

      expect(() =>
        ReviewStateCodec.parse(JSON.stringify({ ...state, comments }))
      ).toThrow(NestedError)
    })

    it("rejects a comment record with an unknown action", () => {
      const state = createState(),
        corrupted = {
          ...state,
          comments: {
            "comment-1": { lastAction: "ignore", revision: 1, at: "now" }
          }
        }

      expect(() => ReviewStateCodec.parse(JSON.stringify(corrupted))).toThrow(
        NestedError
      )
    })
  })
})

describe("ReviewStateText", () => {
  describe("sanitizeText", () => {
    it("keeps printable text unchanged", () => {
      expect(
        ReviewStateText.sanitizeText("design/plans/MySpecialPlan", 64)
      ).toBe("design/plans/MySpecialPlan")
    })

    it("strips control characters and truncates", () => {
      expect(ReviewStateText.sanitizeText("a\u001b[2Jb", 64)).toBe("a[2Jb")
      expect(ReviewStateText.sanitizeText("abcdef", 3)).toBe("abc")
      expect(ReviewStateText.sanitizeText(null, 8)).toBe("")
      expect(ReviewStateText.sanitizeText(42, 8)).toBe("")
    })
  })

  describe("isCommentId", () => {
    it("accepts a Google Docs comment id", () => {
      expect(ReviewStateText.isCommentId("AAABcD_eF-g")).toBe(true)
    })

    it("refuses anything else", () => {
      expect(ReviewStateText.isCommentId("")).toBe(false)
      expect(ReviewStateText.isCommentId(null)).toBe(false)
      expect(ReviewStateText.isCommentId("has space")).toBe(false)
      expect(ReviewStateText.isCommentId("a".repeat(129))).toBe(false)
    })
  })

  describe("appendCommentRecord", () => {
    const record = {
      lastAction: CommentAction.reply,
      revision: 1,
      at: "2026-09-16T14:02:00.000Z"
    }

    it("adds one record", () => {
      expect(
        ReviewStateText.appendCommentRecord({}, "comment-1", record)
      ).toEqual({ "comment-1": record })
    })

    it("drops the oldest once the map is full", () => {
      const full = Object.fromEntries(
          Array.from(
            { length: ReviewStateText.MaxComments },
            (_unused, index) => [`comment-${index}`, record]
          )
        ),
        appended = ReviewStateText.appendCommentRecord(
          full,
          "comment-new",
          record
        )

      expect(Object.keys(appended)).toHaveLength(ReviewStateText.MaxComments)
      expect(appended).not.toHaveProperty("comment-0")
      expect(appended).toHaveProperty("comment-new")
    })
  })
})
