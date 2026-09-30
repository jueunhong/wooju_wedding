/**
 * 청첩장 참석 여부 · 축하 메시지 → 구글 시트
 *
 * 사용법
 * 1. 구글 시트를 새로 만든다.
 * 2. 메뉴 [확장 프로그램] → [Apps Script] 를 열고, 이 파일 내용을 전부 붙여 넣은 뒤 저장한다.
 * 3. [배포] → [새 배포] → 유형: 웹 앱
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자
 *    → [배포] → 권한 승인 → 나오는 "웹 앱 URL"(https://script.google.com/macros/s/.../exec)을 복사
 * 4. js/main.js 의 RSVP_ENDPOINT 에 그 URL 을 넣는다.
 *
 * 같은 하객이 "다시 작성하기"로 수정하면 새 줄이 생기지 않고 그 사람의 줄이 고쳐진다 (응답 ID 기준).
 */

const SHEET_NAME = "응답";
const HEADERS = ["제출 시각", "성함", "참석 여부", "인원", "축하 메시지", "응답 ID"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const p = (e && e.parameter) || {};
    const id = clean_(p.id, 64);
    const row = [
      new Date(),
      clean_(p.name, 50),
      p.attend === "yes" ? "참석" : "불참",
      p.attend === "yes" ? Math.max(1, Math.min(10, Number(p.count) || 1)) : 0,
      clean_(p.message, 300),
      id
    ];

    const sheet = getSheet_();
    const existing = id ? findRowById_(sheet, id) : 0;
    if (existing) {
      sheet.getRange(existing, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 브라우저로 웹 앱 URL 을 열었을 때 연결 확인용
function doGet() {
  return json_({ ok: true, message: "RSVP endpoint is running" });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#f3e6e6");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(5, 360);
  }
  return sheet;
}

function findRowById_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const col = HEADERS.indexOf("응답 ID") + 1;
  const ids = sheet.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return 0;
}

// 길이 제한 + 수식으로 해석되지 않게 (=, +, -, @ 로 시작하면 앞에 ' 를 붙임)
function clean_(value, max) {
  let text = String(value || "").trim().slice(0, max);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
