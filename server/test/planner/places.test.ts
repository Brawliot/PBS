import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { COMMON_WORDS, findPlace, normalizeWords } from "../../planner/places.js";
import type { Place } from "../../data/es-places.js";
import "./helpers.js";

// Test fixtures only: the real list is data/es-places.ts
const PLACES: Place[] = [
  { name: "Madrid" },
  { name: "Sevilla" },
  { name: "Real Sitio de San Ildefonso" },
  { name: "Malasaña", city: "Madrid" },
  { name: "Sol", city: "Madrid" },
  { name: "Triana", city: "Sevilla" },
  { name: "Mar", city: "Cádiz" },
];

describe("findPlace", () => {
  test("a municipality is found as written", () => {
    assert.equal(findPlace("A tapas bar in Madrid", PLACES), "Madrid");
  });

  test("a neighbourhood gives 'Neighbourhood, City'", () => {
    assert.equal(findPlace("A tapas bar in Malasaña, Madrid", PLACES), "Malasaña, Madrid");
  });

  test("accents and capitals do not matter", () => {
    assert.equal(findPlace("bar en MALASANA madrid", PLACES), "Malasaña, Madrid");
    assert.equal(findPlace("Taller en triana", PLACES), "Triana, Sevilla");
  });

  test("the longest name wins: a neighbourhood beats the city it is in", () => {
    assert.equal(findPlace("Madrid, bar en Malasaña", PLACES), "Malasaña, Madrid");
  });

  test("a longer name that contains a shorter one wins", () => {
    assert.equal(findPlace("Opening in Real Sitio de San Ildefonso", PLACES), "Real Sitio de San Ildefonso");
  });

  test("only whole words match", () => {
    assert.equal(findPlace("Malasañana bar", PLACES), null);
    assert.equal(findPlace("Madridista club", PLACES), null);
  });

  test("a common word is never a place on its own", () => {
    assert.equal(findPlace("Quiero un bar mar adentro", PLACES), null);
    assert.equal(findPlace("Escuela de vela en el mar de Cádiz", PLACES), null);
  });

  test("no place in the text gives null", () => {
    assert.equal(findPlace("A bakery delivery app", PLACES), null);
  });

  test("the built-in list is empty until it is filled from the INE file", () => {
    assert.equal(findPlace("A tapas bar in Madrid"), null);
  });

  test("the common words are normalized like the places", () => {
    assert.ok(COMMON_WORDS.has(normalizeWords("Ribera")));
  });
});
