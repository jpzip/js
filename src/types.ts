/**
 * Types mirroring the jpzip protocol specification (spec_version 1.0).
 * Mirror of https://github.com/jpzip/spec/blob/main/schema/v1/zipcode-entry.json
 */

export interface Town {
  town: string;
  kana: string;
  roma: string;
  note?: string;
}

export interface ZipcodeEntry {
  prefecture: string;
  prefecture_kana: string;
  prefecture_roma: string;
  prefecture_code: string;
  city: string;
  city_kana: string;
  city_roma: string;
  city_code: string;
  towns: Town[];
}

export interface Endpoints {
  all: string;
  group: string;
  prefix: string;
}

export interface Meta {
  version: string;
  generated_at: string;
  spec_version: string;
  total_zipcodes: number;
  prefix_count: number;
  by_pref: Record<string, number>;
  data_source: string;
  endpoints: Endpoints;
}

/** Dictionary keyed by 7-digit zipcode string, as published by the CDN. */
export type ZipcodeDict = Record<string, ZipcodeEntry>;
