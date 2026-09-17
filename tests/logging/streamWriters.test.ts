import {
  FsUtils,
  StreamWriters,
  writeStderr,
  writeStdout
} from "claude-gdoc-review-plugin"

describe("writeStdout", () => {
  it("writes the text verbatim, without adding a terminator", () => {
    const chunks: string[] = [],
      spy = jest
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: unknown) => {
          chunks.push(String(chunk))
          return true
        })

    try {
      writeStdout('{"a":1}')
      writeStdout(StreamWriters.LineSeparator)
    } finally {
      spy.mockRestore()
    }

    expect(chunks).toEqual(['{"a":1}', "\n"])
  })

  it("writes nothing for an empty string", () => {
    const chunks: string[] = [],
      spy = jest
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: unknown) => {
          chunks.push(String(chunk))
          return true
        })

    try {
      writeStdout("")
    } finally {
      spy.mockRestore()
    }

    expect(chunks.join("")).toBe("")
  })
})

describe("writeStderr", () => {
  it("writes to stderr and never to stdout", () => {
    const errorChunks: string[] = [],
      outChunks: string[] = [],
      errorSpy = jest
        .spyOn(process.stderr, "write")
        .mockImplementation((chunk: unknown) => {
          errorChunks.push(String(chunk))
          return true
        }),
      outSpy = jest
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: unknown) => {
          outChunks.push(String(chunk))
          return true
        })

    try {
      writeStderr(`broken${StreamWriters.LineSeparator}`)
    } finally {
      errorSpy.mockRestore()
      outSpy.mockRestore()
    }

    expect(errorChunks.join("")).toBe("broken\n")
    expect(outChunks).toEqual([])
  })
})

describe("StreamWriters", () => {
  it("states the line terminator and shares the one encoding constant", () => {
    expect(StreamWriters.LineSeparator).toBe("\n")
    expect(FsUtils.Encoding).toBe("utf8")
  })
})
