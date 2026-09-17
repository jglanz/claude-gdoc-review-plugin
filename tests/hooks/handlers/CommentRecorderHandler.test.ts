import {
  CommentAction,
  DocumentCommentAction,
  GDocReview,
  handleCommentRecorder,
  HookInput,
  PostToolUseHookInput,
  ReviewStateText
} from "claude-gdoc-review-plugin"

import {
  createActiveReviewState,
  createHookInput,
  createHookTestEnvironment,
  createTestPluginConfig,
  destroyHookTestEnvironment,
  destroyHookTestEnvironments,
  FixtureNow,
  HookTestEnvironment,
  writePlanText
} from "../../support/hookTestSupport.js"

function asPostToolUse(input: HookInput): PostToolUseHookInput {
  return input as PostToolUseHookInput
}

describe("handleCommentRecorder", () => {
  const inlineEnvironments: HookTestEnvironment[] = []

  let environment: HookTestEnvironment = null

  /**
   * Builds a second environment the `afterEach` will destroy whatever the test
   * does, so a failing assertion cannot leave its directories behind.
   */
  async function createInlineEnvironment(
    options: Parameters<typeof createHookTestEnvironment>[0] = {}
  ): Promise<HookTestEnvironment> {
    const inline = await createHookTestEnvironment(options)
    inlineEnvironments.push(inline)
    return inline
  }

  beforeEach(async () => {
    environment = await createHookTestEnvironment()
    await writePlanText(environment, "# Fixture plan\n")
    await environment.store.save(
      createActiveReviewState(environment, { revision: 2 })
    )
  })

  afterEach(async () => {
    try {
      await destroyHookTestEnvironment(environment)
    } finally {
      await destroyHookTestEnvironments(inlineEnvironments)
    }
  })

  it("captures the revision-log comment created during setup", async () => {
    const input = asPostToolUse(
      createHookInput(environment, "post-tool-use-manage-comment-create.json")
    )

    expect(await handleCommentRecorder(input, environment.context)).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBe("comment-log-1")
  })

  it("captures the revision-log comment under a configured reply prefix", async () => {
    const prefixed = await createInlineEnvironment({
      config: { ...createTestPluginConfig(), replyPrefix: "[bot]" }
    })

    await writePlanText(prefixed, "# Fixture plan\n")
    await prefixed.store.save(createActiveReviewState(prefixed))

    const input = asPostToolUse(
      createHookInput(prefixed, "post-tool-use-manage-comment-create.json", {
        tool_input: {
          action: "create",
          comment_content: `${GDocReview.newRevisionLogMarker("[bot]")} — entries follow`
        }
      })
    )

    await handleCommentRecorder(input, prefixed.context)

    expect((await prefixed.store.load(prefixed.planSlug)).logCommentId).toBe(
      "comment-log-1"
    )
  })

  it("ignores the default marker when another prefix is configured", async () => {
    const prefixed = await createInlineEnvironment({
      config: { ...createTestPluginConfig(), replyPrefix: "[bot]" }
    })

    await writePlanText(prefixed, "# Fixture plan\n")
    await prefixed.store.save(createActiveReviewState(prefixed))

    const input = asPostToolUse(
      createHookInput(prefixed, "post-tool-use-manage-comment-create.json")
    )

    await handleCommentRecorder(input, prefixed.context)

    expect(
      (await prefixed.store.load(prefixed.planSlug)).logCommentId
    ).toBeNull()
  })

  it("ignores a created comment that is not the revision log", async () => {
    const input = asPostToolUse(
      createHookInput(environment, "post-tool-use-manage-comment-create.json", {
        tool_input: {
          action: "create",
          comment_content: "A note for the reviewer"
        }
      })
    )

    await handleCommentRecorder(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBeNull()
  })

  it("ignores a create response carrying no comment id", async () => {
    const input = asPostToolUse(
      createHookInput(environment, "post-tool-use-manage-comment-create.json", {
        tool_response: "Error: the comment could not be created"
      })
    )

    await handleCommentRecorder(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).logCommentId
    ).toBeNull()
  })

  it("records a reply against the current revision", async () => {
    const input = asPostToolUse(
      createHookInput(environment, "post-tool-use-manage-comment-reply.json")
    )

    await handleCommentRecorder(input, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).comments
    ).toEqual({
      "comment-c1": {
        lastAction: CommentAction.reply,
        revision: 2,
        at: FixtureNow.toISOString()
      }
    })
  })

  it("overwrites the reply record when the same thread is resolved", async () => {
    const replyInput = asPostToolUse(
        createHookInput(environment, "post-tool-use-manage-comment-reply.json")
      ),
      resolveInput = asPostToolUse(
        createHookInput(
          environment,
          "post-tool-use-manage-comment-reply.json",
          {
            tool_input: { action: "resolve", comment_id: "comment-c1" },
            tool_response: "Comment resolved"
          }
        )
      )

    await handleCommentRecorder(replyInput, environment.context)
    await handleCommentRecorder(resolveInput, environment.context)

    expect(
      (await environment.store.load(environment.planSlug)).comments[
        "comment-c1"
      ].lastAction
    ).toBe(CommentAction.resolve)
  })

  it("ignores a reply naming no comment and an unknown action", async () => {
    const withoutId = asPostToolUse(
        createHookInput(
          environment,
          "post-tool-use-manage-comment-reply.json",
          {
            tool_input: {
              action: "reply",
              comment_content: `${GDocReview.ReplyPrefix} hi`
            }
          }
        )
      ),
      unknownAction = asPostToolUse(
        createHookInput(
          environment,
          "post-tool-use-manage-comment-reply.json",
          {
            tool_input: { action: "delete", comment_id: "comment-c1" }
          }
        )
      )

    expect(
      await handleCommentRecorder(withoutId, environment.context)
    ).toBeNull()
    expect(
      await handleCommentRecorder(unknownAction, environment.context)
    ).toBeNull()
    expect(
      (await environment.store.load(environment.planSlug)).comments
    ).toEqual({})
  })

  it("stays silent when the plan has no review", async () => {
    const other = await createInlineEnvironment(),
      input = asPostToolUse(
        createHookInput(other, "post-tool-use-manage-comment-reply.json")
      )

    await writePlanText(other, "# Another plan\n")

    expect(await handleCommentRecorder(input, other.context)).toBeNull()
  })

  it("records nothing for a comment id that is not one", async () => {
    for (const commentId of ["has space", "a".repeat(129), "", null]) {
      const input = asPostToolUse(
        createHookInput(
          environment,
          "post-tool-use-manage-comment-reply.json",
          {
            tool_input: {
              document_id: "1FixtureDocIdAbCdEfGhIjKlMnOpQrStUvWxYz01",
              action: DocumentCommentAction.reply,
              comment_id: commentId
            }
          }
        )
      )

      expect(await handleCommentRecorder(input, environment.context)).toBeNull()
      expect(
        (await environment.store.load(environment.planSlug)).comments
      ).toEqual({})
    }
  })

  it("drops the oldest entry once the comment map is full", async () => {
    const state = await environment.store.load(environment.planSlug),
      full = Object.fromEntries(
        Array.from(
          { length: ReviewStateText.MaxComments },
          (_unused, index) => [
            `comment${index}`,
            {
              lastAction: CommentAction.reply,
              revision: 1,
              at: FixtureNow.toISOString()
            }
          ]
        )
      )

    await environment.store.save({ ...state, comments: full })

    const input = asPostToolUse(
      createHookInput(environment, "post-tool-use-manage-comment-reply.json", {
        tool_input: {
          document_id: "1FixtureDocIdAbCdEfGhIjKlMnOpQrStUvWxYz01",
          action: DocumentCommentAction.reply,
          comment_id: "commentnewest"
        }
      })
    )

    await handleCommentRecorder(input, environment.context)

    const { comments } = await environment.store.load(environment.planSlug)

    // The map is bookkeeping the gate never reads, so it is bounded rather than
    // allowed to grow one entry per thread for the life of the review.
    expect(Object.keys(comments)).toHaveLength(ReviewStateText.MaxComments)
    expect(comments).not.toHaveProperty("comment0")
    expect(comments).toHaveProperty("commentnewest")
  })
})
