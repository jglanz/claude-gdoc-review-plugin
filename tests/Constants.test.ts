import { GDocReview } from "claude-gdoc-review-plugin"

describe("GDocReview constants", () => {
  it("names the plugin exactly as the manifest and package do", () => {
    expect(GDocReview.PluginName).toBe("claude-gdoc-review-plugin")
  })

  it("keeps review state under its own directory name", () => {
    expect(GDocReview.StateDirName).toBe("gdoc-review")
  })

  it("marks agent replies with the robot prefix", () => {
    expect(GDocReview.ReplyPrefix).toBe("🤖")
  })

  it("headers the approval menu", () => {
    expect(GDocReview.MenuHeader).toBe("GDoc Review")
  })

  it("opens the revision log with the agent prefix so entries are findable", () => {
    expect(GDocReview.RevisionLogMarker).toBe("🤖 Revision log")
    expect(
      GDocReview.RevisionLogMarker.startsWith(GDocReview.ReplyPrefix)
    ).toBe(true)
  })

  it("derives the revision-log marker from a configured reply prefix", () => {
    expect(GDocReview.newRevisionLogMarker("[bot]")).toBe("[bot] Revision log")
    expect(GDocReview.newRevisionLogMarker(GDocReview.ReplyPrefix)).toBe(
      GDocReview.RevisionLogMarker
    )
  })

  it("still builds a marker when the prefix is empty", () => {
    expect(GDocReview.newRevisionLogMarker("")).toBe(
      ` ${GDocReview.RevisionLogTitle}`
    )
  })

  it("exposes no empty constant", () => {
    Object.values(GDocReview)
      .filter(value => typeof value === "string")
      .forEach(value => expect(value).not.toBe(""))
  })
})
