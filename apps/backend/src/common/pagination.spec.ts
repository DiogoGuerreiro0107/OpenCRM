import "reflect-metadata";
import { afterKey, decodeKey, encodeKey, KeyField, readPage } from "./pagination";

const KEY: KeyField[] = [
  { field: "due", dir: "asc", kind: "date" },
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

describe("pagination", () => {
  it("cursor vai e volta com datas, números e texto", () => {
    const values = [new Date("2026-11-19T10:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"), "abc"];
    expect(decodeKey(encodeKey(values), KEY)).toEqual(values);
    const numeric: KeyField[] = [{ field: "order", dir: "asc", kind: "number" }, { field: "id", dir: "asc", kind: "string" }];
    expect(decodeKey(encodeKey([-3, "x"]), numeric)).toEqual([-3, "x"]);
  });

  it("cursor inválido, de outro tamanho ou com tipos errados dá null (primeira página)", () => {
    expect(decodeKey(undefined, KEY)).toBeNull();
    expect(decodeKey("lixo", KEY)).toBeNull();
    expect(decodeKey(encodeKey(["a", "b"]), KEY)).toBeNull();
    expect(decodeKey(encodeKey(["não é data", "2026-01-01T00:00:00.000Z", "x"]), KEY)).toBeNull();
    expect(decodeKey(encodeKey(["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", 5]), KEY)).toBeNull();
  });

  it("«depois do cursor» respeita a direção de cada coluna", () => {
    const [d, c] = [new Date(1), new Date(2)];
    expect(afterKey(KEY, [d, c, "z"])).toEqual({
      OR: [{ due: { gt: d } }, { due: d, createdAt: { lt: c } }, { due: d, createdAt: c, id: { lt: "z" } }],
    });
  });

  it("readPage pede limit + 1 e só dá cursor quando há mais", async () => {
    const key: KeyField[] = [{ field: "id", dir: "asc", kind: "string" }];
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const fetch = jest.fn(async (_after: unknown, take: number) => rows.slice(0, take));
    const page = await readPage(key, { limit: 2 }, fetch);
    expect(fetch).toHaveBeenCalledWith(undefined, 3);
    expect(page.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(decodeKey(page.nextCursor!, key)).toEqual(["b"]);
    expect((await readPage(key, { limit: 3 }, fetch)).nextCursor).toBeNull();
  });
});
