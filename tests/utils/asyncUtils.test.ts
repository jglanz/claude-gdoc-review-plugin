import { getValue, guard } from "claude-gdoc-review-plugin"

describe("asyncUtils", () => {
  describe("guard", () => {
    it("runs the effect", async () => {
      const effect = jest.fn()
      await guard(effect)

      expect(effect).toHaveBeenCalledTimes(1)
    })

    it("swallows a synchronous throw", async () => {
      const throwing = () => {
        throw new Error("sync boom")
      }

      await expect(guard(throwing)).resolves.toBeUndefined()
    })

    it("swallows a rejected promise", async () => {
      await expect(
        guard(async () => Promise.reject(new Error("async boom")))
      ).resolves.toBeUndefined()
    })
  })

  describe("getValue", () => {
    it("returns the produced value", () => {
      expect(getValue(() => JSON.parse('{"a":1}'), null)).toEqual({ a: 1 })
    })

    it("returns the fallback when the producer throws", () => {
      expect(getValue(() => JSON.parse("{ broken"), null)).toBeNull()
      expect(getValue<string>(() => JSON.parse("{ broken"), "fallback")).toBe(
        "fallback"
      )
    })
  })
})
