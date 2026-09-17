import {
  readToolResponseText,
  ToolResponseText
} from "claude-gdoc-review-plugin"

describe("readToolResponseText", () => {
  it("returns a plain text response unchanged", () => {
    expect(readToolResponseText("Document ID: abc")).toBe("Document ID: abc")
  })

  it("reads the text of an MCP result envelope", () => {
    expect(readToolResponseText({ result: "Comment ID: c1" })).toBe(
      "Comment ID: c1"
    )
  })

  it("reads the first content block of an MCP content envelope", () => {
    expect(
      readToolResponseText({
        content: [
          { type: "text", text: "File ID: f1" },
          { type: "text", text: "ignored" }
        ]
      })
    ).toBe("File ID: f1")
  })

  it("serializes any other object so the text parsers still see it", () => {
    expect(readToolResponseText({ documentId: "abc" })).toBe(
      '{"documentId":"abc"}'
    )
    expect(readToolResponseText([1, 2])).toBe("[1,2]")
  })

  it("serializes a content envelope whose blocks carry no text", () => {
    expect(readToolResponseText({ content: [{ type: "image" }] })).toBe(
      '{"content":[{"type":"image"}]}'
    )
    expect(readToolResponseText({ content: [] })).toBe('{"content":[]}')
  })

  it("has nothing to read for an absent response", () => {
    expect(readToolResponseText(null)).toBeNull()
    expect(readToolResponseText(undefined)).toBeNull()
  })

  it("survives a response that cannot be serialized", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(readToolResponseText(circular)).toBeNull()
  })

  it("reads the first content block by the documented index", () => {
    expect(ToolResponseText.FirstContentIndex).toBe(0)
  })
})
