import { expect, test } from "vitest";

import {
  barcodeLookupCandidates,
  hasValidGtinCheckDigit,
  isSupportedCommercialBarcode,
} from "../app/catalog/barcode";

test.each([
  "96385074",
  "04252614",
  "01234505",
  "01234514",
  "01234523",
  "01234531",
  "01234543",
  "11234538",
  "034000470693",
  "4006381333931",
  "10012345678902",
])("%s has a valid GTIN check digit", (barcode) => {
  expect(hasValidGtinCheckDigit(barcode)).toBe(true);
});

test.each([
  "96385075",
  "034000470694",
  "4006381333932",
  "10012345678903",
  "",
  "0",
  "123456",
  "1234567",
  "123456789",
  "a12345678",
  "12345678a",
  "21234551",
  "20000013",
  "00000050",
  "04252615",
  " 0000000",
  "0000000 ",
  "not-a-barcode",
])("%s does not have a valid GTIN check digit", (barcode) => {
  expect(hasValidGtinCheckDigit(barcode)).toBe(false);
});

test("manual barcode compatibility remains length-based", () => {
  expect(isSupportedCommercialBarcode("1234567")).toBe(true);
  expect(isSupportedCommercialBarcode("034000470694")).toBe(true);
  expect(isSupportedCommercialBarcode("123456")).toBe(false);
  expect(isSupportedCommercialBarcode("123456a")).toBe(false);
});

test.each([
  ["643843715887", ["643843715887", "0643843715887", "00643843715887"]],
  ["0643843715887", ["0643843715887", "643843715887", "00643843715887"]],
  ["00643843715887", ["00643843715887", "643843715887", "0643843715887"]],
  ["4006381333931", ["4006381333931", "04006381333931"]],
  ["10012345678902", ["10012345678902"]],
  ["034000470694", ["034000470694"]],
  ["1234567", ["1234567"]],
  ["96385074", ["96385074"]],
  ["04252614", ["04252614"]],
  ["not-a-barcode", ["not-a-barcode"]],
])("lookup candidates for %s preserve exact identity and only vary valid GTIN padding", (barcode, candidates) => {
  expect(barcodeLookupCandidates(barcode)).toEqual(candidates);
});
