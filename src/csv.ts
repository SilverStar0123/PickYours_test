// CSV 읽기, ES_list.csv/units.csv → 소속사·유닛·멤버 목록 만들기
import type { Agency, Group, NameMap } from "./types";
import { LOGO_IMG_DIR, MEMBER_IMG_DIR, agencyConfig } from "./config";
import Papa from "papaparse";
import { avatarUri, badgeUri, resolveAsset, resolveImg } from "./assets";

// CSV 행의 키(BOM/공백/대소문자)와 값(따옴표)을 정리
function cleanRow(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    out[key.replace(/^\uFEFF/, "").trim().toLowerCase()] = String(row[key] ?? "");
  }
  return out;
}

const stripQuotes = (v: unknown) => String(v ?? "").replace(/['"]/g, "").trim();

// public 폴더의 CSV 파일을 읽어 (키가 정리된) 행 배열로 반환
function loadCsv(file: string): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(`${process.env.PUBLIC_URL || "."}/${file}?${Date.now()}`, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.map(cleanRow)),
      error: (err) => reject(err)
    });
  });
}

// ES_list.csv(멤버)와 units.csv(유닛 로고·언어별 이름)를 읽어 소속사 → 유닛 → 멤버 목록을 만듦.
// 멤버 id는 "유닛이름::한국어이름" (서버에 저장되는 값이므로 함부로 바꾸지 마세요)
// CSV 경로가 틀려 HTML이 읽히면 code가 "csv-path"인 에러를 던집니다.
export async function loadAgencies(): Promise<Agency[]> {
  const rows = await loadCsv("ES_list.csv");
  if (rows.length > 0 && Object.keys(rows[0]).join("").includes("html")) {
    throw Object.assign(new Error("csv-path"), { code: "csv-path" }); // 경로가 틀려 HTML(404 페이지)이 읽힘
  }

  // units.csv: unit,logo  → 유닛·소속사 이름(대소문자 무시)으로 로고 연결. 파일이 없어도 정상 동작
  const logoMap: Record<string, string> = {};
  const nameMap: Record<string, NameMap> = {}; // units.csv의 name_en / name_ja
  try {
    const unitRows = await loadCsv("units.csv");
    unitRows.forEach((r) => {
      if (!("unit" in r)) return; // 파일이 없어 404 HTML이 읽힌 경우 무시
      const key = stripQuotes(r.unit).toLowerCase();
      const logo = resolveImg(stripQuotes(r.logo), LOGO_IMG_DIR);
      if (key && logo) logoMap[key] = logo;
      const en = stripQuotes(r.name_en);
      const ja = stripQuotes(r.name_ja);
      if (key && (en || ja)) nameMap[key] = { en, ja };
    });
  } catch (err) {
    console.warn("units.csv를 읽지 못해 글자 로고를 사용합니다.", err);
  }
  const usedIds = new Set<string>();
  const parsed: Agency[] = agencyConfig.map((cfg, aIdx) => {
    const groups: Group[] = [];
    cfg.units.forEach((unit) => {
      const unitRows = rows.filter(
        (r) => stripQuotes(r.unit).toLowerCase() === unit.name.toLowerCase()
      );
      if (unitRows.length === 0) return;

      groups.push({
        id: unit.name,
        name: unit.name,
        names: nameMap[unit.name.toLowerCase()],
        logo:
          logoMap[unit.name.toLowerCase()] ||
          resolveAsset(unit.logo) ||
          badgeUri(unit.name, 120, 120, true),
        members: unitRows.map((r) => {
          const mName = stripQuotes(r.name) || "알수없음";
          let id = `${unit.name}::${mName}`;
          for (let n = 2; usedIds.has(id); n++) id = `${unit.name}::${mName}#${n}`; // 동명이인 대비
          usedIds.add(id);
          const fallback = avatarUri(mName);
          return {
            id,
            groupId: unit.name,
            name: mName,
            names: { en: stripQuotes(r.name_en ?? ""), ja: stripQuotes(r.name_ja ?? "") },
            img: resolveImg(stripQuotes(r.img), MEMBER_IMG_DIR) || fallback,
            fallback
          };
        })
      });
    });
    return {
      id: `agency-${aIdx}`,
      name: cfg.name,
      names: nameMap[cfg.name.toLowerCase()],
      logo:
        logoMap[cfg.name.toLowerCase()] ||
        resolveAsset(cfg.logo) ||
        badgeUri(cfg.name, 240, 48, false),
      groups
    };
  });
  return parsed;
}
