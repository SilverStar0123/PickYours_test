// 취향표 종류와 고유 주소/저장 공간. 새 종류는 여기에서 추가합니다.
export type PickSheetId = "current" | "special" | "shuffle1" | "shuffle2";
export const SPECIAL_UNITS = [
  "데드맨즈", "구fine", "나이트 킬러즈", "team 우시와카마루", "트로이메라이",
  "Rain-bows", "Babarrier", "Lilith", "DoubleFace", "오기인",
  "Eve", "Adam", "J&A"
] as const;

export type PickSheet = {
  id: PickSheetId;
  source: "unit" | "ex_unit" | "shuffle1" | "shuffle2";
  multiplayer: boolean;
  collection: string;
  route: string;
  labels: { ko: string; en: string; ja: string };
};
export const PICK_SHEETS: Record<PickSheetId, PickSheet> = {
  current: { id: "current", source: "unit", multiplayer: true, collection: "rooms", route: "#/picks", labels: { ko: "현재 유닛", en: "Current Units", ja: "現行ユニット" } },
  special: { id: "special", source: "ex_unit", multiplayer: true, collection: "specialRooms", route: "#/picks/special", labels: { ko: "스페셜 유닛", en: "Special Units", ja: "スペシャルユニット" } },
  shuffle1: { id: "shuffle1", source: "shuffle1", multiplayer: false, collection: "", route: "#/picks/shuffle1", labels: { ko: "Shuffle 1", en: "Shuffle 1", ja: "Shuffle 1" } },
  shuffle2: { id: "shuffle2", source: "shuffle2", multiplayer: false, collection: "", route: "#/picks/shuffle2", labels: { ko: "Shuffle 2", en: "Shuffle 2", ja: "Shuffle 2" } }
};
export const PICK_SHEET_IDS: PickSheetId[] = ["current", "special", "shuffle1", "shuffle2"];

// 해시 주소가 선택지를 명시하지 않는 경우(퀴즈 화면 등) null을 반환합니다.
export function sheetFromHash(hash: string): PickSheetId | null {
  const path = hash.replace(/^#\/?/, "").split("?")[0].replace(/\/$/, "").toLowerCase();
  if (path === "picks" || path === "home") return "current";
  if (path === "picks/special") return "special";
  if (path === "picks/shuffle1") return "shuffle1";
  if (path === "picks/shuffle2") return "shuffle2";
  return null;
}

// 기존 취향표의 로컬 저장 키는 그대로 유지해 과거 데이터를 보호합니다.
export function sheetLocalKey(base: string, sheet: PickSheetId): string {
  return sheet === "current" ? base : `${base}:${sheet}`;
}
