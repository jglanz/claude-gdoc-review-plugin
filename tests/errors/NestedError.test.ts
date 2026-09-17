import { NestedError } from "claude-gdoc-review-plugin"

describe("NestedError", () => {
  it("keeps the cause, the context and the cause's stack", () => {
    const cause = new Error("root cause"),
      error = new NestedError("wrapping failed", {
        cause,
        context: { file: "/tmp/plan.md" }
      })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe(NestedError.Name)
    expect(error.message).toBe("wrapping failed")
    expect(error.cause).toBe(cause)
    expect(error.context).toEqual({ file: "/tmp/plan.md" })
    expect(error.stack).toContain(NestedError.CausedByPrefix)
    expect(error.stack).toContain("root cause")
  })

  it("defaults the cause to null and the context to an empty bag", () => {
    const error = new NestedError("no detail available", {})

    expect(error.cause).toBeNull()
    expect(error.context).toEqual({})
    expect(error.stack).not.toContain(NestedError.CausedByPrefix)
  })

  it("renders a thrown value that is not an Error", () => {
    const error = new NestedError("a string was thrown", { cause: "boom" })

    expect(error.stack).toContain(`${NestedError.CausedByPrefix} boom`)
  })

  describe("stackOf", () => {
    it("is empty for an absent cause", () => {
      expect(NestedError.stackOf(null)).toBe("")
      expect(NestedError.stackOf(undefined)).toBe("")
    })

    it("falls back to name and message when an Error carries no stack", () => {
      const cause = new Error("no stack here")
      cause.stack = undefined

      expect(NestedError.stackOf(cause)).toBe("Error: no stack here")
    })

    it("stringifies an arbitrary value", () => {
      expect(NestedError.stackOf(42)).toBe("42")
    })
  })
})
