import { isNonEmptyString, isRecord, isString } from "claude-gdoc-review-plugin"

describe("typeUtils", () => {
  describe("isString", () => {
    it("accepts a primitive string", () => {
      expect(isString("")).toBe(true)
      expect(isString("plan")).toBe(true)
    })

    it("rejects everything else", () => {
      expect(isString(null)).toBe(false)
      expect(isString(undefined)).toBe(false)
      expect(isString(7)).toBe(false)
      expect(isString(["a"])).toBe(false)
    })
  })

  describe("isNonEmptyString", () => {
    it("accepts a string with content", () => {
      expect(isNonEmptyString("plan")).toBe(true)
    })

    it("rejects the empty string and non-strings", () => {
      expect(isNonEmptyString("")).toBe(false)
      expect(isNonEmptyString(null)).toBe(false)
      expect(isNonEmptyString(0)).toBe(false)
    })
  })

  describe("isRecord", () => {
    it("accepts a plain keyed object", () => {
      expect(isRecord({})).toBe(true)
      expect(isRecord({ code: "ENOENT" })).toBe(true)
    })

    it("rejects null, arrays and primitives", () => {
      expect(isRecord(null)).toBe(false)
      expect(isRecord([1, 2])).toBe(false)
      expect(isRecord("text")).toBe(false)
    })
  })
})
