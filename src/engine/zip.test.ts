import { expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { uniqueNames, zip } from "./zip.ts";

test("names are made unique, case-insensitively", () => {
  expect(uniqueNames(["photo.jpg", "photo.jpg", "Photo.JPG", "a", "a", "dir/x.png", "dir/x.png"])).toEqual(["photo.jpg", "photo-2.jpg", "Photo-3.JPG", "a", "a-2", "dir/x.png", "dir/x-2.png"]);
});

test("round trip", () => {
  const files = [
    { name: "a.jpg", bytes: new Uint8Array([1, 2, 3]) },
    { name: "a.jpg", bytes: new Uint8Array([4, 5]) },
    { name: "notes.txt", bytes: new TextEncoder().encode("hello hello hello hello") },
  ];
  const back = unzipSync(zip(files));
  expect(Object.keys(back).sort()).toEqual(["a-2.jpg", "a.jpg", "notes.txt"]);
  expect(back["a-2.jpg"]).toEqual(new Uint8Array([4, 5]));
  expect(new TextDecoder().decode(back["notes.txt"])).toBe("hello hello hello hello");
});
