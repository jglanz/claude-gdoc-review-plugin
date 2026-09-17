import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

import {
  NestedError,
  PlanDigest,
  sha256OfFile,
  sha256OfText,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

const KnownText = "abc",
  KnownDigest =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

describe("PlanDigest", () => {
  let workingPath: string = null

  beforeEach(async () => {
    workingPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("digest-")
    )
  })

  afterEach(async () => {
    await rm(workingPath, { recursive: true, force: true })
  })

  it("names its algorithm and encoding", () => {
    expect(PlanDigest.Algorithm).toBe("sha256")
    expect(PlanDigest.Encoding).toBe("hex")
  })

  describe("sha256OfText", () => {
    it("matches the published SHA-256 vector", () => {
      expect(sha256OfText(KnownText)).toBe(KnownDigest)
    })

    it("hashes the empty string and rejects a non-string", () => {
      expect(sha256OfText("")).toHaveLength(64)
      expect(() => sha256OfText(null)).toThrow()
    })
  })

  describe("sha256OfFile", () => {
    it("produces the same digest as the file's text", async () => {
      const file = path.join(workingPath, "plan.md")
      await writeFileAtomic(file, KnownText)

      expect(await sha256OfFile(file)).toBe(KnownDigest)
    })

    it("returns null when the plan has not been written yet", async () => {
      expect(await sha256OfFile(path.join(workingPath, "absent.md"))).toBeNull()
    })

    it("wraps any other failure in a NestedError", async () => {
      await expect(sha256OfFile(workingPath)).rejects.toBeInstanceOf(
        NestedError
      )
    })
  })
})
