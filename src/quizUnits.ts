// 음악 퀴즈의 출제 유닛 분류.
// 정규 유닛: 취향표에 표시되는 기존 유닛(id 및 한국어/영어/일본어 표기)
// 퓨전곡: 정규 유닛 둘 이상을 &, ×, VS 등으로 연결한 이름 또는 명시적 퓨전곡 분류
// 셔플곡: 위 둘에 속하지 않는 나머지 모든 유닛명
// songs.csv의 원래 unit 값은 SongItem.rawUnit에 그대로 보관한다.

export const SHUFFLE_UNIT_ID = "__shuffle__";
export const FUSION_UNIT_ID = "__fusion__";

interface OfficialUnitName {
  id: string;
  name?: string;
  names?: { ko?: string; en?: string; ja?: string };
}

const EXPLICIT_FUSION_LABELS = new Set(["퓨전곡", "퓨전 유닛", "fusion", "fusion song", "fusion songs", "fusion unit"]);
const EXPLICIT_SHUFFLE_LABELS = new Set(["셔플곡", "셔플 유닛", "shuffle", "shuffle song", "shuffle songs", "shuffle unit", "shuffle units"]);

function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

// 앱에서 이미 읽은 취향표 정규 유닛을 진실의 원천으로 사용.
// 번역된 표기(예: '紅月', 'Akatsuki')도 기존 유닛으로 인식한다.
export function makeOfficialUnitAliases(units: ReadonlyArray<OfficialUnitName>): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const unit of units) {
    for (const label of [unit.id, unit.name, unit.names?.ko, unit.names?.en, unit.names?.ja]) {
      if (label && nameKey(label)) aliases.set(nameKey(label), unit.id);
    }
  }
  return aliases;
}

// 결합 기호만으로 퓨전곡이라고 판단하지 않는다.
// 양쪽 모두 알려진 정규 유닛이어야 한다. (기호를 쓴 셔플 그룹명 오분류 방지)
const FUSION_SEPARATOR = /\s+(?:vs\.?|x)\s+|[&＆×✕✖]/i;

export function classifyQuizUnit(rawName: string, officialAliases: ReadonlyMap<string, string>): string {
  const name = rawName.trim();
  const key = nameKey(name);

  // 취향표에 있는 정규 유닛은 항상 정규 유닛으로 취급한다.
  const canonicalUnit = officialAliases.get(key);
  if (canonicalUnit) return canonicalUnit;

  if (EXPLICIT_FUSION_LABELS.has(key)) return FUSION_UNIT_ID;
  if (EXPLICIT_SHUFFLE_LABELS.has(key)) return SHUFFLE_UNIT_ID;

  const parts = name.split(FUSION_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((part) => officialAliases.has(nameKey(part)))) {
    return FUSION_UNIT_ID;
  }

  // ES_list.csv의 shuffle1 등에 없더라도, 새로운 이름은 자동으로 셔플곡에 포함한다.
  return SHUFFLE_UNIT_ID;
}
