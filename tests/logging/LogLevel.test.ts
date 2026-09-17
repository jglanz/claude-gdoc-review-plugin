import { LogLevel } from "claude-gdoc-review-plugin"

describe("LogLevel", () => {
  it("is identity-mapped, so a persisted value is its own member name", () => {
    Object.entries(LogLevel).forEach(([name, value]) => {
      expect(value).toBe(name)
    })
  })

  it("carries exactly the levels the file logger exposes", () => {
    expect(Object.values(LogLevel)).toEqual([
      "log",
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal"
    ])
  })

  it("does not carry a level the logger has no method for", () => {
    expect(Object.values(LogLevel)).not.toContain("verbose")
    expect(LogLevel["verbose"]).toBeUndefined()
  })
})
