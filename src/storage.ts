// 이 기기(localStorage)에 저장하는 값: 내 선택, 닉네임, 참여한 방 목록
import {
  MAX_NICKNAME_LENGTH, MY_ROOMS_KEY, MY_ROOMS_MAX, NICK_KEY, PICKS_KEY, ROOM_ID_PATTERN
} from "./config";
import type { MyRoom, Picks } from "./types";

export function saveLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속에서만 유지 */
  }
}

export function loadMyRooms(): MyRoom[] {
  try {
    const raw = window.localStorage.getItem(MY_ROOMS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x) =>
          x &&
          typeof x.id === "string" &&
          ROOM_ID_PATTERN.test(x.id) &&
          typeof x.nickname === "string" &&
          typeof x.lastAt === "number"
      )
      .map((x) => ({
        id: x.id,
        nickname: x.nickname,
        lastAt: x.lastAt,
        roomName: typeof x.roomName === "string" ? x.roomName : ""
      }))
      .slice(0, MY_ROOMS_MAX);
  } catch {
    return [];
  }
}

export function saveMyRooms(list: MyRoom[]) {
  try {
    window.localStorage.setItem(MY_ROOMS_KEY, JSON.stringify(list));
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속에서만 유지 */
  }
}

export function loadLocalPicks(): Picks {
  try {
    const raw = window.localStorage.getItem(PICKS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const out: Picks = {};
    if (obj && typeof obj === "object") {
      Object.entries(obj).forEach(([g, m]) => {
        if (typeof m === "string") out[g] = m;
      });
    }
    return out;
  } catch {
    return {};
  }
}

export function loadLocalNickname(): string {
  try {
    return (window.localStorage.getItem(NICK_KEY) || "").slice(0, MAX_NICKNAME_LENGTH);
  } catch {
    return "";
  }
}
