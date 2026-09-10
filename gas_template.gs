// ============================================================
// 案件管理ツール（見積書）- GASテンプレート
// ============================================================
// 【使い方】
// 1. 新しいGoogleスプレッドシートを作成する
// 2. メニュー「拡張機能」→「Apps Script」を開く
// 3. デフォルトで入っているコードを全部消し、このファイルの中身を
//    全部貼り付けて保存する（フロッピーアイコン、またはCtrl+S）
// 4. 右上の「デプロイ」→「新しいデプロイ」をクリック
//    - 種類の選択：歯車アイコン→「ウェブアプリ」
//    - 説明：任意（例：見積書2026）
//    - 次のユーザーとして実行：自分
//    - アクセスできるユーザー：全員
//    →「デプロイ」をクリック
// 5. 初回のみ権限の承認を求められるので許可する
//    （「このアプリは Google で確認されていません」と出た場合は
//     「詳細」→「安全ではないページに移動」で進めて問題ありません。
//     これはGoogle公式の審査を受けていない個人のスクリプトを
//     実行する際に必ず表示される、Google側の定型的な確認です。
//     コードの中身はこのファイルで全文確認できます。
//     「エラー 401: invalid_client」が表示された場合は、
//     そのエラー画面を閉じてから、もう一度「アクセスを承認」を
//     押し直すと解消することがあります）
// 6. スプレッドシートを開き直すと「設定」「登録リスト」タブが
//    自動的に作られます。まず「設定」タブに自社名などを入力してください
//    （自社名は必須、他の項目は未入力でも初期値のまま動きます）。
//    「登録リスト」タブに部署名候補・担当者一覧（担当者名/電話/メール）を
//    入力しておくと、見積書作成フォームで選択できるようになります
// 7. 表示された「ウェブアプリのURL」を、見積書ツール（ホーム画面）の
//    接続設定に貼り付ける。社内で使う全員が同じURLを使います
//
// コードを更新した場合は、既存のデプロイに対して
// 「デプロイを管理」→「新バージョン」で反映させてください
// （コードの保存だけでは、公開中のURLには反映されません）。
//
// 見積書の作成・自動転記はこのツール（HTML）から行い、
// 受注日・失注日・出荷日・受注確度などの進捗更新は、このスプレッドシートの
// 「見積明細」タブを直接編集して行います（日付・プルダウンは自動で
// 設定されます）。
// ============================================================

const SHEET_CONFIG = '設定';
const SHEET_LISTS = '登録リスト';
const SHEET_HEADER = '見積ヘッダー';
const SHEET_DETAIL = '見積明細';
const SHEET_BACKUP_LOG = 'バックアップ履歴';
const SHEET_BACKUP_LIST = 'バックアップ一覧';
const SHEET_DELETE_LOG = '削除ログ';
const SHEET_RESTORE_LOG = '復元ログ';

const HEADER_COLS = ['書類番号', '発行日', '取引先名', '先方担当者名', '自社名', '部署名', '担当者名', '連絡先', '有効期限', '支払条件', '備考', 'フリー項目値', '進捗管理対象'];
const DETAIL_COLS = ['書類番号', '行番号', '品番', '品名', '数量', '単価', '税率', '金額', '受注日', '納期', '失注日', '出荷日', '備考', '受注確度'];
// バックアップ履歴：見積ヘッダー・見積明細の全項目を1明細1行でフラットに複製して記録する（差分表示機能用）。
// 書類番号・備考は両シートに存在するため、備考のみヘッダー分／明細分を分けて名前を付ける。
const BACKUP_COLS = ['バックアップID', 'バックアップ名', 'バックアップ日時', '書類番号', '発行日', '取引先名', '先方担当者名', '自社名', '部署名', '担当者名', '連絡先', '有効期限', '支払条件', '備考(ヘッダー)', 'フリー項目値', '進捗管理対象', '行番号', '品番', '品名', '数量', '単価', '税率', '金額', '受注日', '納期', '失注日', '出荷日', '備考(明細)', '受注確度'];
const BACKUP_LIST_COLS = ['バックアップID', 'バックアップ名', 'バックアップ日時', '件数'];
const DELETE_LOG_COLS = ['書類番号', '削除日時'];
const RESTORE_LOG_COLS = ['書類番号', '行番号', '復元日時', '元バックアップID'];

const H = {};
HEADER_COLS.forEach(function (c, i) { H[c] = i; });
const D = {};
DETAIL_COLS.forEach(function (c, i) { D[c] = i; });
const BK = {};
BACKUP_COLS.forEach(function (c, i) { BK[c] = i; });

// 見積明細シートのみに置く「参照用」列（見積ヘッダーの値・要注意判定を数式で常時同期表示）。
// 条件付き書式は別シートを直接参照できないため、この列を経由して同一シート内で判定する。
// DETAIL_COLS（実データ）には含めず、submitQuotation/getDashboardData等の読み書きの対象外とする。
const DETAIL_HELPER_EXPIRY_COL = DETAIL_COLS.length + 1; // 有効期限（参照）
const DETAIL_HELPER_TRACK_COL = DETAIL_COLS.length + 2; // 進捗管理対象（参照）
const DETAIL_HELPER_KIND_COL = DETAIL_COLS.length + 3; // 要注意種別（有効期限超過／納期超過／空欄）

// [項目, 初期値, 説明]
const CONFIG_DEFAULTS = [
  ['自社名', '', '見積書に印字される発行者名（必須）'],
  ['部署名入力方式', '自由入力', '「自由入力」または「選択式」。選択式の場合は登録リストタブの部署名候補から選びます'],
  ['フリー項目ラベル', '備考2', '⑦の追加項目のラベル名（例：プロジェクトキー）。入力欄は自由入力（過去の入力値を候補表示）です'],
  ['フリー項目印字有無', '印字する', '「印字する」または「印字しない」。社内管理用に記録だけして客先向け書類には出さない場合は「印字しない」'],
  ['書類番号prefix', 'Q', '例：Q-202609-001 のように使われます（見積・発注で別々に設定）'],
  ['デフォルト税率(%)', '10', '明細行の税率欄に入る初期値（行ごとに上書き可）'],
  ['事業年度開始月', '4', '事業年度の開始月（1〜12）。ダッシュボードの「今期累計」集計に使用'],
  ['消費税端数処理', '四捨五入', '「切り捨て」「切り上げ」「四捨五入」のいずれか。税率ごとの小計に対して1回だけ適用します'],
  ['有効期限デフォルト方式', '自由入力', '「自動計算」または「自由入力」。自動計算＝発行日から下の日数を足した日付を自動入力／自由入力＝未入力のまま開始（手動で日付を選んでもらう）'],
  ['有効期限デフォルト日数', '30', '有効期限デフォルト方式が「自動計算」のときに使う日数（発行日からの日数）'],
  ['支払条件デフォルト値', '', '見積書作成フォームの支払条件欄に自動入力する文言（空欄可。例：納品後月末締め翌月末払い）'],
  ['バックアップ保持数上限', '3', '「差分表示」タブで保存できるバックアップの最大件数。超えると古いものから自動的に削除されます（0にすると無制限）']
];

// ---------------- エントリーポイント ----------------

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'ping') return jsonOut({ ok: true });
    if (action === 'getInitData') return jsonOut(getInitData());
    if (action === 'getDashboardData') return jsonOut(getDashboardData());
    if (action === 'getBackups') return jsonOut(getBackups());
    if (action === 'getBackupData') return jsonOut(getBackupData(e.parameter.backupId));
    return jsonOut({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'submitQuotation') return jsonOut(submitQuotation(body));
    if (action === 'createBackup') return jsonOut(createBackup(body));
    if (action === 'importBackup') return jsonOut(importBackup(body));
    if (action === 'restoreDetailRows') return jsonOut(restoreDetailRows(body));
    if (action === 'deleteQuotation') return jsonOut(deleteQuotation(body));
    return jsonOut({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  ensureSheetsExist();
  SpreadsheetApp.getUi().createMenu('案件管理ツール（見積）')
    .addItem('🔄 データ検証・書式を再設定', 'reapplyValidation')
    .addToUi();
}

// ---------------- 初期化 ----------------

function ensureSheetsExist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureConfigSheet_(ss);
  ensureListsSheet_(ss);
  ensureHeaderSheet_(ss);
  ensureDetailSheet_(ss);
  ensureBackupLogSheet_(ss);
  ensureBackupListSheet_(ss);
  ensureDeleteLogSheet_(ss);
  ensureRestoreLogSheet_(ss);
}

function ensureConfigSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_CONFIG);
  if (sh) {
    syncConfigDefaults_(sh);
    return sh;
  }
  sh = ss.insertSheet(SHEET_CONFIG);
  sh.setFrozenRows(2);
  sh.getRange(1, 1, 1, 3).merge().setValue('👇「値」列を入力してください（自社名は必須、他は空欄のままでも初期値で動きます）').setFontWeight('bold').setFontColor('#ffffff');
  sh.getRange(1, 1, 1, 3).setBackground('#2563eb');
  sh.getRange(2, 1, 1, 3).setValues([['項目', '値', '説明']]).setFontWeight('bold');
  sh.getRange(2, 1, 1, 3).setBackground('#e2e5ea');
  sh.getRange(3, 1, CONFIG_DEFAULTS.length, 3).setValues(CONFIG_DEFAULTS);
  sh.getRange(3, 3, CONFIG_DEFAULTS.length, 1).setFontColor('#6b7280').setWrap(true);
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 420);
  applyConfigValidation_(sh);
  applyConfigConditionalFormat_(sh);
  return sh;
}

// 既存の設定シートに対し、CONFIG_DEFAULTSにあってシートに無い項目だけを末尾に追記する。
// 既存の値がある項目には一切触れない（ユーザーが入力済みの値を保護するため）。
// アプリの更新で設定項目が増えるたびに、この関数だけで既存ユーザーへの反映が完結する。
function syncConfigDefaults_(sh) {
  const last = sh.getLastRow();
  const existingKeys = {};
  if (last >= 3) {
    sh.getRange(3, 1, last - 2, 1).getValues().forEach(function (r) { if (r[0]) existingKeys[String(r[0]).trim()] = true; });
  }
  const missing = CONFIG_DEFAULTS.filter(function (row) { return !existingKeys[row[0]]; });
  if (missing.length === 0) return;
  const startRow = Math.max(last, 2) + 1;
  sh.getRange(startRow, 1, missing.length, 3).setValues(missing);
  sh.getRange(startRow, 3, missing.length, 1).setFontColor('#6b7280').setWrap(true);
  applyConfigValidation_(sh);
  applyConfigConditionalFormat_(sh);
}

// 項目名（列A）でシート上の実際の行を検索する。CONFIG_DEFAULTS配列内の並び順とは
// 独立に行番号を決めるための共通ヘルパー。syncConfigDefaults_で既存シートの末尾に
// 項目を追記すると、配列のインデックスと物理的な行番号が一致しなくなるため、
// 検証・条件付き書式の対象行は必ずこの関数で実際のラベルと照合して特定すること。
function findConfigRow_(sh, key) {
  const last = sh.getLastRow();
  if (last < 3) return -1;
  const keys = sh.getRange(3, 1, last - 2, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) return 3 + i;
  }
  return -1;
}

// 選択式の項目は「値」列にプルダウン（データ検証）を設定し、
// 誤字での入力ミスを防ぐ
function applyConfigValidation_(sh) {
  const CONFIG_CHOICES = {
    '部署名入力方式': ['自由入力', '選択式'],
    'フリー項目印字有無': ['印字する', '印字しない'],
    '消費税端数処理': ['切り捨て', '切り上げ', '四捨五入'],
    '有効期限デフォルト方式': ['自動計算', '自由入力'],
    '事業年度開始月': ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
  };
  Object.keys(CONFIG_CHOICES).forEach(function (key) {
    const rowNum = findConfigRow_(sh, key);
    if (rowNum === -1) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(CONFIG_CHOICES[key], true).setAllowInvalid(false).build();
    sh.getRange(rowNum, 2).setDataValidation(rule);
  });

  // 数値のみを求める項目："30日"のような単位付き文字入力をデータ検証で拒否しつつ、
  // 表示形式（カスタム書式）で単位を自動表示し、単位を手入力する動機自体を減らす
  const CONFIG_NUMBER_FIELDS = {
    'デフォルト税率(%)': '%',
    '有効期限デフォルト日数': '日',
    'バックアップ保持数上限': '件'
  };
  Object.keys(CONFIG_NUMBER_FIELDS).forEach(function (key) {
    const rowNum = findConfigRow_(sh, key);
    if (rowNum === -1) return;
    const cell = sh.getRange(rowNum, 2);
    const rule = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build();
    cell.setDataValidation(rule);
    cell.setNumberFormat('0"' + CONFIG_NUMBER_FIELDS[key] + '"');
  });
}

// 「有効期限デフォルト方式」が「自由入力」のときは「有効期限デフォルト日数」が
// 使われない（設定不要）ことが分かるよう、その行をグレーアウトする
function applyConfigConditionalFormat_(sh) {
  const modeRow = findConfigRow_(sh, '有効期限デフォルト方式');
  const daysRow = findConfigRow_(sh, '有効期限デフォルト日数');
  if (modeRow === -1 || daysRow === -1) return;
  const range = sh.getRange(daysRow, 1, 1, 3);
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B$' + modeRow + '="自由入力"')
    .setBackground('#f1f1f1')
    .setFontColor('#b0b0b0')
    .setRanges([range])
    .build();
  const existing = sh.getConditionalFormatRules().filter(function (r) {
    return r.getRanges().every(function (rg) { return rg.getRow() !== daysRow; });
  });
  existing.push(rule);
  sh.setConditionalFormatRules(existing);
}

function ensureListsSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_LISTS);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_LISTS);
  sh.setFrozenRows(2);
  sh.getRange(1, 1, 1, 5).merge().setValue('👇 部署名候補・担当者一覧を入力してください（見積書作成フォームの選択肢になります）').setFontWeight('bold').setFontColor('#ffffff');
  sh.getRange(1, 1, 1, 5).setBackground('#2563eb');
  sh.getRange(2, 1).setValue('部署名候補').setFontWeight('bold');
  sh.getRange(2, 3, 1, 3).setValues([['担当者名', '電話', 'メール']]).setFontWeight('bold');
  sh.getRange(2, 1, 1, 5).setBackground('#e2e5ea');
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 24);
  sh.setColumnWidth(3, 120);
  sh.setColumnWidth(4, 120);
  sh.setColumnWidth(5, 200);
  return sh;
}

function ensureHeaderSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_HEADER);
  if (!sh) {
    sh = ss.insertSheet(SHEET_HEADER);
    sh.setFrozenRows(1);
  }
  sh.getRange(1, 1, 1, HEADER_COLS.length).setValues([HEADER_COLS]).setFontWeight('bold');
  sh.getRange(1, 1, 1, HEADER_COLS.length).setBackground('#e2e5ea');
  return sh;
}

function ensureDetailSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_DETAIL);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DETAIL);
    sh.setFrozenRows(1);
  }
  sh.getRange(1, 1, 1, DETAIL_COLS.length).setValues([DETAIL_COLS]).setFontWeight('bold');
  sh.getRange(1, 1, 1, DETAIL_COLS.length).setBackground('#e2e5ea');
  sh.getRange(1, DETAIL_HELPER_EXPIRY_COL, 1, 3).setValues([['有効期限（参照）', '進捗管理対象（参照）', '要注意種別']]).setFontWeight('bold');
  sh.getRange(1, DETAIL_HELPER_EXPIRY_COL, 1, 3).setBackground('#e2e5ea');
  applyDetailAlertFormat_(sh);
  return sh;
}

// バックアップ履歴：見積ヘッダー・見積明細の全項目を1明細1行でフラットに複製して記録する保存先。
// 差分表示機能でのみ書き込まれる（手動編集は想定しない、内容確認は自由）
function ensureBackupLogSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_BACKUP_LOG);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_BACKUP_LOG);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, BACKUP_COLS.length).setValues([BACKUP_COLS]).setFontWeight('bold');
  sh.getRange(1, 1, 1, BACKUP_COLS.length).setBackground('#e2e5ea');
  sh.getRange(1, 1).setNote('見積書ツールの「差分表示」機能が自動生成するバックアップです。手動編集は避けてください。不要なバックアップはこのシート上で行ごと削除して構いません。');
  return sh;
}

// バックアップ一覧：バックアップ履歴を全件スキャンしなくても選択肢を出せるようにする索引
function ensureBackupListSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_BACKUP_LIST);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_BACKUP_LIST);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, BACKUP_LIST_COLS.length).setValues([BACKUP_LIST_COLS]).setFontWeight('bold');
  sh.getRange(1, 1, 1, BACKUP_LIST_COLS.length).setBackground('#e2e5ea');
  sh.getRange(1, 1).setNote('自動生成される索引です。手動編集は避けてください。バックアップ履歴シート側の行を削除した場合はこちらの対応行も削除してください。');
  return sh;
}

// 削除ログ：見積書ツールの「この見積書を削除する」ボタン（正規の削除機能）で削除された
// 書類番号・削除日時のみを記録する（個人情報は含まない）。差分表示の「削除された品目」欄で、
// 正規に削除されたものか原因不明の消失かを見分けるために使う。
function ensureDeleteLogSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_DELETE_LOG);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_DELETE_LOG);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, DELETE_LOG_COLS.length).setValues([DELETE_LOG_COLS]).setFontWeight('bold');
  sh.getRange(1, 1, 1, DELETE_LOG_COLS.length).setBackground('#e2e5ea');
  sh.getRange(1, 1).setNote('見積書ツールの「この見積書を削除する」ボタンで削除された書類番号が自動的に記録されます。');
  return sh;
}

// 復元ログ：見積書ツールの「差分表示」タブから復元された明細（書類番号・行番号）と、
// 復元元となったバックアップIDを記録する。削除ログと対になる監査用の記録。
function ensureRestoreLogSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_RESTORE_LOG);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_RESTORE_LOG);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, RESTORE_LOG_COLS.length).setValues([RESTORE_LOG_COLS]).setFontWeight('bold');
  sh.getRange(1, 1, 1, RESTORE_LOG_COLS.length).setBackground('#e2e5ea');
  sh.getRange(1, 1).setNote('見積書ツールの「差分表示」タブから復元された明細が自動的に記録されます。');
  return sh;
}

// 要注意（有効期限超過・納期超過）の品目を、見積明細シート上でも
// 条件付き書式でハイライトする（HTML側ダッシュボードの要注意一覧と同じ判定条件）。
// このシートの条件付き書式はこの関数だけが管理する前提で、毎回まるごと置き換える。
function colLetter_(colNum1based) {
  let s = '', n = colNum1based;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 条件付き書式は別シートを直接参照できないため、writeDetailHelperFormulas_が計算した
// 同一シート内の「要注意種別」列（有効期限超過／納期超過／空欄）だけを見て、種類ごとに色分けする
function applyDetailAlertFormat_(sh) {
  // 固定行数（2000行等）を指定すると、新規作成直後でまだ行数が少ないシートで
  // 「範囲がシートの最大行数を超えている」エラーになるため、実際の最大行数を使う
  const lastRow = Math.max(sh.getMaxRows(), 2);
  const range = sh.getRange(2, 1, lastRow - 1, DETAIL_COLS.length);
  const kindCol = '$' + colLetter_(DETAIL_HELPER_KIND_COL) + '2';
  const expiryRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=' + kindCol + '="有効期限超過"')
    .setBackground('#fff3cd')
    .setRanges([range])
    .build();
  const dueRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=' + kindCol + '="納期超過"')
    .setBackground('#fce8e6')
    .setRanges([range])
    .build();
  sh.setConditionalFormatRules([dueRule, expiryRule]);
}

// ---------------- 設定・登録リストの読み出し ----------------

function getConfigMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureConfigSheet_(ss);
  const last = sh.getLastRow();
  const map = {};
  if (last >= 3) {
    const vals = sh.getRange(3, 1, last - 2, 2).getValues();
    vals.forEach(function (r) { if (r[0]) map[String(r[0]).trim()] = r[1]; });
  }
  return map;
}

function getConfig_() {
  const m = getConfigMap_();
  function s(key, def) {
    const v = m[key];
    return (v === undefined || v === null || v === '') ? def : String(v);
  }
  // 0は「無制限」を意味する正当な値のため、他の数値項目のような ||デフォルト は使わず、
  // NaNのときだけ既定値3にフォールバックする
  const backupLimitNum = Number(s('バックアップ保持数上限', '3'));
  return {
    companyName: s('自社名', ''),
    deptMode: s('部署名入力方式', '自由入力'),
    freeLabel: s('フリー項目ラベル', '備考2'),
    freePrint: s('フリー項目印字有無', '印字する'),
    prefix: s('書類番号prefix', 'Q'),
    taxDefault: Number(s('デフォルト税率(%)', '10')) || 10,
    fiscalMonth: Number(s('事業年度開始月', '4')) || 4,
    roundMode: s('消費税端数処理', '四捨五入'),
    expiryMode: s('有効期限デフォルト方式', '自由入力'),
    expiryDays: Number(s('有効期限デフォルト日数', '30')) || 0,
    termsDefault: s('支払条件デフォルト値', ''),
    backupLimit: isNaN(backupLimitNum) ? 3 : backupLimitNum
  };
}

function getLists_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureListsSheet_(ss);
  const last = sh.getLastRow();
  const depts = [];
  const staff = [];
  if (last >= 3) {
    const vals = sh.getRange(3, 1, last - 2, 5).getValues();
    vals.forEach(function (r) {
      if (r[0]) depts.push(String(r[0]));
      if (r[2]) staff.push({ name: String(r[2]), tel: r[3] ? String(r[3]) : '', email: r[4] ? String(r[4]) : '' });
    });
  }
  return { depts: depts, staff: staff };
}

// ---------------- 作成フォーム用の初期データ ----------------

function getInitData() {
  ensureSheetsExist();
  const config = getConfig_();
  const lists = getLists_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hSh = ss.getSheetByName(SHEET_HEADER);
  const hLast = hSh.getLastRow();
  const clients = {};
  const freeValues = {};
  if (hLast >= 2) {
    const vals = hSh.getRange(2, 1, hLast - 1, HEADER_COLS.length).getValues();
    vals.forEach(function (r) {
      const c = r[H['取引先名']]; if (c) clients[String(c)] = true;
      const f = r[H['フリー項目値']]; if (f) freeValues[String(f)] = true;
    });
  }
  return {
    ok: true,
    config: config,
    depts: lists.depts,
    staff: lists.staff,
    clients: Object.keys(clients).sort(),
    freeValues: Object.keys(freeValues).sort()
  };
}

// ---------------- 書類番号の採番 ----------------

function generateDocNo_(prefix) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_HEADER);
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const ym = Utilities.formatDate(new Date(), tz, 'yyyyMM');
  const base = prefix + '-' + ym + '-';
  let maxSeq = 0;
  const last = sh.getLastRow();
  if (last >= 2) {
    const vals = sh.getRange(2, H['書類番号'] + 1, last - 1, 1).getValues();
    vals.forEach(function (r) {
      const v = String(r[0] || '');
      if (v.indexOf(base) === 0) {
        const seq = parseInt(v.slice(base.length), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
  }
  const next = maxSeq + 1;
  return base + ('000' + next).slice(-3);
}

function parseDate_(str) {
  if (!str) return '';
  const parts = String(str).split('-');
  if (parts.length !== 3) return '';
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d);
}

// 'yyyy-MM-dd HH:mm'（fmtDateTime_の出力形式）を Date に戻す。バックアップのインポート時、
// エクスポート元の「バックアップ日時」文字列を元の日時のまま保持するために使う。
function parseDateTime_(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0, mi = m[5] ? Number(m[5]) : 0;
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, hh, mi);
}

// ---------------- 見積書の登録（自動転記） ----------------

// body = {
//   action:'submitQuotation', client, clientContact, dept, staff, expiry, terms, memo, freeValue,
//   trackProgress: boolean,
//   items:[{pin, name, qty, unitPrice, taxRate, dueDate, memo}, ...]
// }
function submitQuotation(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureSheetsExist();
    const config = getConfig_();
    const lists = getLists_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hSh = ss.getSheetByName(SHEET_HEADER);
    const dSh = ss.getSheetByName(SHEET_DETAIL);
    const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';

    const docNo = generateDocNo_(config.prefix);
    const now = new Date();

    let contact = '';
    const staffMatch = lists.staff.filter(function (s) { return s.name === body.staff; })[0];
    if (staffMatch) contact = [staffMatch.tel, staffMatch.email].filter(Boolean).join(' / ');

    const headerRow = [];
    headerRow[H['書類番号']] = docNo;
    headerRow[H['発行日']] = now;
    headerRow[H['取引先名']] = body.client || '';
    headerRow[H['先方担当者名']] = body.clientContact || '';
    headerRow[H['自社名']] = config.companyName;
    headerRow[H['部署名']] = body.dept || '';
    headerRow[H['担当者名']] = body.staff || '';
    headerRow[H['連絡先']] = contact;
    headerRow[H['有効期限']] = parseDate_(body.expiry);
    headerRow[H['支払条件']] = body.terms || '';
    headerRow[H['備考']] = body.memo || '';
    headerRow[H['フリー項目値']] = body.freeValue || '';
    headerRow[H['進捗管理対象']] = body.trackProgress !== false;

    hSh.getRange(hSh.getLastRow() + 1, 1, 1, HEADER_COLS.length).setValues([headerRow]);
    const hRowNum = hSh.getLastRow();
    hSh.getRange(hRowNum, H['発行日'] + 1).setNumberFormat('yyyy-mm-dd');
    hSh.getRange(hRowNum, H['有効期限'] + 1).setNumberFormat('yyyy-mm-dd');
    hSh.getRange(hRowNum, H['進捗管理対象'] + 1).insertCheckboxes();

    const items = body.items || [];
    const rows = items.map(function (it, i) {
      const qty = Number(it.qty) || 0;
      const price = Number(it.unitPrice) || 0;
      const amount = qty * price;
      const row = [];
      row[D['書類番号']] = docNo;
      row[D['行番号']] = i + 1;
      row[D['品番']] = it.pin || '';
      row[D['品名']] = it.name || '';
      row[D['数量']] = qty;
      row[D['単価']] = price;
      row[D['税率']] = Number(it.taxRate) || 0;
      row[D['金額']] = amount;
      row[D['受注日']] = '';
      row[D['納期']] = parseDate_(it.dueDate);
      row[D['失注日']] = '';
      row[D['出荷日']] = '';
      row[D['備考']] = it.memo || '';
      row[D['受注確度']] = '';
      return row;
    });

    if (rows.length > 0) {
      const startRow = dSh.getLastRow() + 1;
      dSh.getRange(startRow, 1, rows.length, DETAIL_COLS.length).setValues(rows);
      applyDetailValidation_(dSh, startRow, rows.length);
      writeDetailHelperFormulas_(dSh, startRow, rows.length);
    }

    return { ok: true, docNo: docNo, issueDate: Utilities.formatDate(now, tz, 'yyyy-MM-dd'), spreadsheetUrl: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

// 「有効期限（参照）」「進捗管理対象（参照）」列に、見積ヘッダーを引く数式を書き込む。
// 通常のセル数式（条件付き書式の数式ではない）なので別シート参照が可能。
function writeDetailHelperFormulas_(sh, startRow, numRows) {
  const oCol = colLetter_(DETAIL_HELPER_EXPIRY_COL);
  const pCol = colLetter_(DETAIL_HELPER_TRACK_COL);
  const formulas = [];
  for (let i = 0; i < numRows; i++) {
    const r = startRow + i;
    const o = '$' + oCol + r, p = '$' + pCol + r;
    formulas.push([
      '=VLOOKUP($A' + r + ',\'' + SHEET_HEADER + '\'!$A:$I,9,FALSE)',
      '=VLOOKUP($A' + r + ',\'' + SHEET_HEADER + '\'!$A:$M,13,FALSE)',
      '=IF(AND($I' + r + '="",$K' + r + '="",' + o + '<>"",' + o + '<TODAY(),' + p + '=TRUE),"有効期限超過",IF(AND($J' + r + '<>"",$J' + r + '<TODAY(),$I' + r + '<>"",$L' + r + '="",' + p + '=TRUE),"納期超過",""))'
    ]);
  }
  sh.getRange(startRow, DETAIL_HELPER_EXPIRY_COL, numRows, 3).setFormulas(formulas);
  sh.getRange(startRow, DETAIL_HELPER_EXPIRY_COL, numRows, 1).setNumberFormat('yyyy-mm-dd');
}

function applyDetailValidation_(sh, startRow, numRows) {
  sh.getRange(startRow, D['受注日'] + 1, numRows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(startRow, D['納期'] + 1, numRows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(startRow, D['出荷日'] + 1, numRows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(startRow, D['失注日'] + 1, numRows, 1).setNumberFormat('yyyy-mm-dd');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['A', 'B', 'C'], true).setAllowInvalid(true).build();
  sh.getRange(startRow, D['受注確度'] + 1, numRows, 1).setDataValidation(rule);
}

// 手作業で行を追加した等の理由でチェックボックス・日付書式・プルダウンが
// 崩れた場合に、既存データ全体へ再適用するためのメニュー用関数
function reapplyValidation() {
  ensureSheetsExist();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cSh = ss.getSheetByName(SHEET_CONFIG);
  if (cSh) {
    applyConfigValidation_(cSh);
    applyConfigConditionalFormat_(cSh);
  }
  const hSh = ss.getSheetByName(SHEET_HEADER);
  const dSh = ss.getSheetByName(SHEET_DETAIL);
  const hLast = hSh.getLastRow();
  if (hLast >= 2) {
    hSh.getRange(2, H['発行日'] + 1, hLast - 1, 1).setNumberFormat('yyyy-mm-dd');
    hSh.getRange(2, H['有効期限'] + 1, hLast - 1, 1).setNumberFormat('yyyy-mm-dd');
    hSh.getRange(2, H['進捗管理対象'] + 1, hLast - 1, 1).insertCheckboxes();
  }
  const dLast = dSh.getLastRow();
  if (dLast >= 2) {
    applyDetailValidation_(dSh, 2, dLast - 1);
    writeDetailHelperFormulas_(dSh, 2, dLast - 1);
  }
  applyDetailAlertFormat_(dSh);
  SpreadsheetApp.getUi().alert('データ検証・書式を再設定しました。');
}

// ---------------- ダッシュボード用データ ----------------

function getDashboardData() {
  ensureSheetsExist();
  const config = getConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const hSh = ss.getSheetByName(SHEET_HEADER);
  const dSh = ss.getSheetByName(SHEET_DETAIL);

  const hLast = hSh.getLastRow();
  const headers = [];
  if (hLast >= 2) {
    const vals = hSh.getRange(2, 1, hLast - 1, HEADER_COLS.length).getValues();
    vals.forEach(function (r) {
      const docNo = r[H['書類番号']];
      if (!docNo) return;
      headers.push({
        docNo: docNo,
        issueDate: fmtDate_(r[H['発行日']], tz),
        client: r[H['取引先名']] || '',
        clientContact: r[H['先方担当者名']] || '',
        company: r[H['自社名']] || '',
        dept: r[H['部署名']] || '',
        staff: r[H['担当者名']] || '',
        contact: r[H['連絡先']] || '',
        expiry: fmtDate_(r[H['有効期限']], tz),
        terms: r[H['支払条件']] || '',
        memo: r[H['備考']] || '',
        freeValue: r[H['フリー項目値']] || '',
        trackProgress: r[H['進捗管理対象']] === true
      });
    });
  }

  const dLast = dSh.getLastRow();
  const details = [];
  if (dLast >= 2) {
    const vals = dSh.getRange(2, 1, dLast - 1, DETAIL_COLS.length).getValues();
    vals.forEach(function (r) {
      const docNo = r[D['書類番号']];
      if (!docNo) return;
      details.push({
        docNo: docNo,
        no: r[D['行番号']],
        pin: r[D['品番']] || '',
        name: r[D['品名']] || '',
        qty: Number(r[D['数量']]) || 0,
        unitPrice: Number(r[D['単価']]) || 0,
        taxRate: Number(r[D['税率']]) || 0,
        amount: Number(r[D['金額']]) || 0,
        orderDate: fmtDate_(r[D['受注日']], tz),
        dueDate: fmtDate_(r[D['納期']], tz),
        lostDate: fmtDate_(r[D['失注日']], tz),
        shipDate: fmtDate_(r[D['出荷日']], tz),
        memo: r[D['備考']] || '',
        confidence: r[D['受注確度']] || ''
      });
    });
  }

  const logSh = ss.getSheetByName(SHEET_DELETE_LOG);
  const logLast = logSh.getLastRow();
  const deleteLog = [];
  if (logLast >= 2) {
    const vals = logSh.getRange(2, 1, logLast - 1, DELETE_LOG_COLS.length).getValues();
    vals.forEach(function (r) {
      if (r[0]) deleteLog.push({ docNo: r[0], deletedAt: fmtDateTime_(r[1], tz) });
    });
  }

  return { ok: true, config: config, headers: headers, details: details, deleteLog: deleteLog };
}

function fmtDate_(v, tz) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v);
}

function fmtDateTime_(v, tz) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

// ---------------- 差分表示：バックアップ・復元・削除 ----------------

// 現在の全品目（進捗管理対象外も含む）をバックアップ履歴・バックアップ一覧に保存する。
// body = { action:'createBackup', label: '（任意のバックアップ名）' }
function createBackup(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureSheetsExist();
    const config = getConfig_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // 新しいバックアップを追加する前に、既存のバックアップの中から古い順に空きを確保する。
    // 追加してから足切りする順序だと、今まさに保存しようとしている分自身が
    // （日時によっては）即座に削除対象になってしまうため、必ず追加前に行う。
    pruneOldBackups_(ss, config.backupLimit, 1);
    const hSh = ss.getSheetByName(SHEET_HEADER);
    const dSh = ss.getSheetByName(SHEET_DETAIL);
    const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';

    const hLast = hSh.getLastRow();
    const headerMap = {};
    if (hLast >= 2) {
      const vals = hSh.getRange(2, 1, hLast - 1, HEADER_COLS.length).getValues();
      vals.forEach(function (r) {
        const docNo = r[H['書類番号']];
        if (docNo) headerMap[docNo] = r;
      });
    }

    const dLast = dSh.getLastRow();
    const detailRows = [];
    if (dLast >= 2) {
      const vals = dSh.getRange(2, 1, dLast - 1, DETAIL_COLS.length).getValues();
      vals.forEach(function (r) {
        if (r[D['書類番号']]) detailRows.push(r);
      });
    }

    const backupId = 'BK-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
    const now = new Date();
    const label = (body && body.label) ? String(body.label) : '';

    const rows = detailRows.map(function (dr) {
      const docNo = dr[D['書類番号']];
      const hr = headerMap[docNo] || [];
      const row = [];
      row[BK['バックアップID']] = backupId;
      row[BK['バックアップ名']] = label;
      row[BK['バックアップ日時']] = now;
      row[BK['書類番号']] = docNo;
      row[BK['発行日']] = hr[H['発行日']] || '';
      row[BK['取引先名']] = hr[H['取引先名']] || '';
      row[BK['先方担当者名']] = hr[H['先方担当者名']] || '';
      row[BK['自社名']] = hr[H['自社名']] || '';
      row[BK['部署名']] = hr[H['部署名']] || '';
      row[BK['担当者名']] = hr[H['担当者名']] || '';
      row[BK['連絡先']] = hr[H['連絡先']] || '';
      row[BK['有効期限']] = hr[H['有効期限']] || '';
      row[BK['支払条件']] = hr[H['支払条件']] || '';
      row[BK['備考(ヘッダー)']] = hr[H['備考']] || '';
      row[BK['フリー項目値']] = hr[H['フリー項目値']] || '';
      row[BK['進捗管理対象']] = hr[H['進捗管理対象']] === true;
      row[BK['行番号']] = dr[D['行番号']];
      row[BK['品番']] = dr[D['品番']];
      row[BK['品名']] = dr[D['品名']];
      row[BK['数量']] = dr[D['数量']];
      row[BK['単価']] = dr[D['単価']];
      row[BK['税率']] = dr[D['税率']];
      row[BK['金額']] = dr[D['金額']];
      row[BK['受注日']] = dr[D['受注日']];
      row[BK['納期']] = dr[D['納期']];
      row[BK['失注日']] = dr[D['失注日']];
      row[BK['出荷日']] = dr[D['出荷日']];
      row[BK['備考(明細)']] = dr[D['備考']];
      row[BK['受注確度']] = dr[D['受注確度']];
      return row;
    });

    const bkSh = ss.getSheetByName(SHEET_BACKUP_LOG);
    if (rows.length > 0) {
      const startRow = bkSh.getLastRow() + 1;
      bkSh.getRange(startRow, 1, rows.length, BACKUP_COLS.length).setValues(rows);
    }

    const listSh = ss.getSheetByName(SHEET_BACKUP_LIST);
    const listRow = [backupId, label, now, rows.length];
    listSh.getRange(listSh.getLastRow() + 1, 1, 1, BACKUP_LIST_COLS.length).setValues([listRow]);
    listSh.getRange(listSh.getLastRow(), 3).setNumberFormat('yyyy-mm-dd hh:mm');

    return { ok: true, backupId: backupId, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// バックアップ一覧・バックアップ履歴を「バックアップ日時」の古い順で判定し、
// これから追加しようとしている新規バックアップ（roomFor件、既定1件）の分の空きを、
// "既存の"バックアップの中から古い順に確保する。limitが0以下の場合は無制限として何もしない。
// 【重要】必ず新規バックアップを追加する前に呼び出すこと。追加した後に呼び出すと、
// 今まさに保存・復元しようとしている分自身が（日時によっては）その場で削除対象に
// なってしまう（例：上限に達している状態で、既存のどれよりも古い日時のバックアップを
// インポートすると、追加した瞬間に一番古い＝今追加したばかりの自分が消える）。
// シートの行順ではなく実際の日時でソートするのは、インポートで過去日時のバックアップが
// 末尾に追加されるケースがあるため。
function pruneOldBackups_(ss, limit, roomFor) {
  if (!limit || limit <= 0) return;
  roomFor = roomFor || 1;
  const listSh = ss.getSheetByName(SHEET_BACKUP_LIST);
  const last = listSh.getLastRow();
  if (last < 2) return;
  const vals = listSh.getRange(2, 1, last - 1, BACKUP_LIST_COLS.length).getValues().filter(function (r) { return r[0]; });
  const excess = (vals.length + roomFor) - limit;
  if (excess <= 0) return;

  const sorted = vals.slice().sort(function (a, b) {
    const ta = a[2] instanceof Date ? a[2].getTime() : 0;
    const tb = b[2] instanceof Date ? b[2].getTime() : 0;
    return ta - tb;
  });
  const toDeleteIds = {};
  sorted.slice(0, Math.min(excess, sorted.length)).forEach(function (r) { toDeleteIds[r[0]] = true; });

  const keptList = vals.filter(function (r) { return !toDeleteIds[r[0]]; });
  listSh.getRange(2, 1, last - 1, BACKUP_LIST_COLS.length).clearContent();
  if (keptList.length > 0) {
    listSh.getRange(2, 1, keptList.length, BACKUP_LIST_COLS.length).setValues(keptList);
    listSh.getRange(2, 3, keptList.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }

  const bkSh = ss.getSheetByName(SHEET_BACKUP_LOG);
  const bkLast = bkSh.getLastRow();
  if (bkLast >= 2) {
    const bkVals = bkSh.getRange(2, 1, bkLast - 1, BACKUP_COLS.length).getValues();
    const keptDetail = bkVals.filter(function (r) { return !toDeleteIds[r[BK['バックアップID']]]; });
    bkSh.getRange(2, 1, bkLast - 1, BACKUP_COLS.length).clearContent();
    if (keptDetail.length > 0) {
      bkSh.getRange(2, 1, keptDetail.length, BACKUP_COLS.length).setValues(keptDetail);
    }
  }
}

// バックアップ一覧（索引）を返す。新しい順。
function getBackups() {
  ensureSheetsExist();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_BACKUP_LIST);
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const last = sh.getLastRow();
  const list = [];
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, BACKUP_LIST_COLS.length).getValues();
    vals.forEach(function (r) {
      if (!r[0]) return;
      list.push({ backupId: String(r[0]), label: r[1] || '', createdAt: fmtDateTime_(r[2], tz), count: Number(r[3]) || 0 });
    });
  }
  list.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  return { ok: true, backups: list };
}

// 指定バックアップの中身を、getDashboardData と同じ { headers, details } 形式で返す
// （フロント側の差分計算ロジックをそのまま再利用できるようにするため）
function getBackupData(backupId) {
  ensureSheetsExist();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_BACKUP_LOG);
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const last = sh.getLastRow();
  const headerMap = {};
  const details = [];
  if (last >= 2 && backupId) {
    const vals = sh.getRange(2, 1, last - 1, BACKUP_COLS.length).getValues();
    vals.forEach(function (r) {
      if (String(r[BK['バックアップID']]) !== String(backupId)) return;
      const docNo = r[BK['書類番号']];
      if (!docNo) return;
      if (!headerMap[docNo]) {
        headerMap[docNo] = {
          docNo: docNo,
          issueDate: fmtDate_(r[BK['発行日']], tz),
          client: r[BK['取引先名']] || '',
          clientContact: r[BK['先方担当者名']] || '',
          company: r[BK['自社名']] || '',
          dept: r[BK['部署名']] || '',
          staff: r[BK['担当者名']] || '',
          contact: r[BK['連絡先']] || '',
          expiry: fmtDate_(r[BK['有効期限']], tz),
          terms: r[BK['支払条件']] || '',
          memo: r[BK['備考(ヘッダー)']] || '',
          freeValue: r[BK['フリー項目値']] || '',
          trackProgress: r[BK['進捗管理対象']] === true
        };
      }
      details.push({
        docNo: docNo,
        no: r[BK['行番号']],
        pin: r[BK['品番']] || '',
        name: r[BK['品名']] || '',
        qty: Number(r[BK['数量']]) || 0,
        unitPrice: Number(r[BK['単価']]) || 0,
        taxRate: Number(r[BK['税率']]) || 0,
        amount: Number(r[BK['金額']]) || 0,
        orderDate: fmtDate_(r[BK['受注日']], tz),
        dueDate: fmtDate_(r[BK['納期']], tz),
        lostDate: fmtDate_(r[BK['失注日']], tz),
        shipDate: fmtDate_(r[BK['出荷日']], tz),
        memo: r[BK['備考(明細)']] || '',
        confidence: r[BK['受注確度']] || ''
      });
    });
  }
  return { ok: true, backupId: backupId, headers: Object.keys(headerMap).map(function (k) { return headerMap[k]; }), details: details };
}

// エクスポートされたバックアップファイル（getBackupDataと同じ{headers, details}形状＋
// backupId/label/createdAt）を、バックアップ履歴・バックアップ一覧に再登録する。
// ライブデータ（見積ヘッダー・見積明細）には一切触れない＝あくまで「バックアップとして復元」する機能。
// 個別の明細をライブデータへ戻したい場合は、登録後にrestoreDetailRowsを使う。
// body = { action:'importBackup', backupId, label, createdAt, headers:[...], details:[...] }
function importBackup(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureSheetsExist();
    const backupId = body && body.backupId;
    const label = (body && body.label) || '';
    const headers = (body && body.headers) || [];
    const details = (body && body.details) || [];
    if (!backupId) return { ok: false, error: 'backupIdが必要です' };
    if (details.length === 0) return { ok: false, error: '明細データが空です' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const listSh = ss.getSheetByName(SHEET_BACKUP_LIST);
    const listLast = listSh.getLastRow();
    if (listLast >= 2) {
      const existingIds = listSh.getRange(2, 1, listLast - 1, 1).getValues().map(function (r) { return r[0]; });
      if (existingIds.indexOf(backupId) !== -1) {
        return { ok: false, error: 'このバックアップは既にインポート済みです（バックアップID：' + backupId + '）' };
      }
    }

    // 追加する前に既存の中から空きを確保する（理由はpruneOldBackups_のコメント参照）。
    // これにより、インポートしようとしているバックアップが既存のどれより古い日時でも、
    // その場で削除されることはない。
    const config = getConfig_();
    pruneOldBackups_(ss, config.backupLimit, 1);

    const headerMap = {};
    headers.forEach(function (h) { headerMap[h.docNo] = h; });
    const createdAtDate = parseDateTime_(body && body.createdAt) || new Date();

    const rows = details.map(function (d) {
      const hr = headerMap[d.docNo] || {};
      const row = [];
      row[BK['バックアップID']] = backupId;
      row[BK['バックアップ名']] = label;
      row[BK['バックアップ日時']] = createdAtDate;
      row[BK['書類番号']] = d.docNo;
      row[BK['発行日']] = parseDate_(hr.issueDate) || hr.issueDate || '';
      row[BK['取引先名']] = hr.client || '';
      row[BK['先方担当者名']] = hr.clientContact || '';
      row[BK['自社名']] = hr.company || '';
      row[BK['部署名']] = hr.dept || '';
      row[BK['担当者名']] = hr.staff || '';
      row[BK['連絡先']] = hr.contact || '';
      row[BK['有効期限']] = parseDate_(hr.expiry) || hr.expiry || '';
      row[BK['支払条件']] = hr.terms || '';
      row[BK['備考(ヘッダー)']] = hr.memo || '';
      row[BK['フリー項目値']] = hr.freeValue || '';
      row[BK['進捗管理対象']] = hr.trackProgress === true;
      row[BK['行番号']] = d.no;
      row[BK['品番']] = d.pin || '';
      row[BK['品名']] = d.name || '';
      row[BK['数量']] = Number(d.qty) || 0;
      row[BK['単価']] = Number(d.unitPrice) || 0;
      row[BK['税率']] = Number(d.taxRate) || 0;
      row[BK['金額']] = Number(d.amount) || 0;
      row[BK['受注日']] = parseDate_(d.orderDate) || d.orderDate || '';
      row[BK['納期']] = parseDate_(d.dueDate) || d.dueDate || '';
      row[BK['失注日']] = parseDate_(d.lostDate) || d.lostDate || '';
      row[BK['出荷日']] = parseDate_(d.shipDate) || d.shipDate || '';
      row[BK['備考(明細)']] = d.memo || '';
      row[BK['受注確度']] = d.confidence || '';
      return row;
    });

    const bkSh = ss.getSheetByName(SHEET_BACKUP_LOG);
    const startRow = bkSh.getLastRow() + 1;
    bkSh.getRange(startRow, 1, rows.length, BACKUP_COLS.length).setValues(rows);

    const listRow = [backupId, label, createdAtDate, rows.length];
    listSh.getRange(listSh.getLastRow() + 1, 1, 1, BACKUP_LIST_COLS.length).setValues([listRow]);
    listSh.getRange(listSh.getLastRow(), 3).setNumberFormat('yyyy-mm-dd hh:mm');

    return { ok: true, backupId: backupId, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// 削除された明細（・そのヘッダー）を、指定バックアップの内容から復元する。
// body = { action:'restoreDetailRows', backupId:'BK-...', items:[{docNo, no}, ...] }
function restoreDetailRows(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureSheetsExist();
    const backupId = body && body.backupId;
    const wantItems = (body && body.items) || [];
    if (!backupId || wantItems.length === 0) return { ok: false, error: 'backupId・itemsが必要です' };

    const backup = getBackupData(backupId);
    const bkHeaderMap = {};
    backup.headers.forEach(function (h) { bkHeaderMap[h.docNo] = h; });
    const bkDetailMap = {};
    backup.details.forEach(function (d) { bkDetailMap[d.docNo + '#' + d.no] = d; });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hSh = ss.getSheetByName(SHEET_HEADER);
    const dSh = ss.getSheetByName(SHEET_DETAIL);

    const hLast = hSh.getLastRow();
    const existingDocs = {};
    if (hLast >= 2) {
      hSh.getRange(2, H['書類番号'] + 1, hLast - 1, 1).getValues().forEach(function (r) { if (r[0]) existingDocs[r[0]] = true; });
    }
    const dLast0 = dSh.getLastRow();
    const existingDetailKeys = {};
    if (dLast0 >= 2) {
      dSh.getRange(2, 1, dLast0 - 1, 2).getValues().forEach(function (r) { if (r[0]) existingDetailKeys[r[0] + '#' + r[1]] = true; });
    }

    const docsToRestoreHeader = {};
    wantItems.forEach(function (it) {
      if (!existingDocs[it.docNo] && bkHeaderMap[it.docNo]) docsToRestoreHeader[it.docNo] = true;
    });

    let restoredHeaders = 0;
    Object.keys(docsToRestoreHeader).forEach(function (docNo) {
      const bh = bkHeaderMap[docNo];
      const row = [];
      row[H['書類番号']] = bh.docNo;
      row[H['発行日']] = parseDate_(bh.issueDate) || bh.issueDate;
      row[H['取引先名']] = bh.client;
      row[H['先方担当者名']] = bh.clientContact;
      row[H['自社名']] = bh.company;
      row[H['部署名']] = bh.dept;
      row[H['担当者名']] = bh.staff;
      row[H['連絡先']] = bh.contact;
      row[H['有効期限']] = parseDate_(bh.expiry) || bh.expiry;
      row[H['支払条件']] = bh.terms;
      row[H['備考']] = bh.memo;
      row[H['フリー項目値']] = bh.freeValue;
      row[H['進捗管理対象']] = bh.trackProgress;
      hSh.getRange(hSh.getLastRow() + 1, 1, 1, HEADER_COLS.length).setValues([row]);
      const hRowNum = hSh.getLastRow();
      hSh.getRange(hRowNum, H['発行日'] + 1).setNumberFormat('yyyy-mm-dd');
      hSh.getRange(hRowNum, H['有効期限'] + 1).setNumberFormat('yyyy-mm-dd');
      hSh.getRange(hRowNum, H['進捗管理対象'] + 1).insertCheckboxes();
      existingDocs[docNo] = true;
      restoredHeaders++;
    });

    const detailRowsToAdd = [];
    const restoreLogRows = [];
    const restoredAt = new Date();
    wantItems.forEach(function (it) {
      const key = it.docNo + '#' + it.no;
      if (existingDetailKeys[key]) return;
      const bd = bkDetailMap[key];
      if (!bd) return;
      const row = [];
      row[D['書類番号']] = bd.docNo;
      row[D['行番号']] = bd.no;
      row[D['品番']] = bd.pin;
      row[D['品名']] = bd.name;
      row[D['数量']] = bd.qty;
      row[D['単価']] = bd.unitPrice;
      row[D['税率']] = bd.taxRate;
      row[D['金額']] = bd.amount;
      row[D['受注日']] = parseDate_(bd.orderDate) || bd.orderDate;
      row[D['納期']] = parseDate_(bd.dueDate) || bd.dueDate;
      row[D['失注日']] = parseDate_(bd.lostDate) || bd.lostDate;
      row[D['出荷日']] = parseDate_(bd.shipDate) || bd.shipDate;
      row[D['備考']] = bd.memo;
      row[D['受注確度']] = bd.confidence;
      detailRowsToAdd.push(row);
      restoreLogRows.push([bd.docNo, bd.no, restoredAt, backupId]);
      existingDetailKeys[key] = true;
    });

    if (detailRowsToAdd.length > 0) {
      const startRow = dSh.getLastRow() + 1;
      dSh.getRange(startRow, 1, detailRowsToAdd.length, DETAIL_COLS.length).setValues(detailRowsToAdd);
      applyDetailValidation_(dSh, startRow, detailRowsToAdd.length);
      writeDetailHelperFormulas_(dSh, startRow, detailRowsToAdd.length);
    }

    if (restoreLogRows.length > 0) {
      const logSh = ss.getSheetByName(SHEET_RESTORE_LOG);
      const logStart = logSh.getLastRow() + 1;
      logSh.getRange(logStart, 1, restoreLogRows.length, RESTORE_LOG_COLS.length).setValues(restoreLogRows);
      logSh.getRange(logStart, 3, restoreLogRows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    }

    return { ok: true, restoredHeaders: restoredHeaders, restoredDetails: detailRowsToAdd.length };
  } finally {
    lock.releaseLock();
  }
}

// 見積書（ヘッダー＋その明細すべて）を丸ごと削除し、削除ログに記録する（正規の削除チャネル）。
// body = { action:'deleteQuotation', docNo:'Q-202609-001' }
function deleteQuotation(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const docNo = body && body.docNo;
    if (!docNo) return { ok: false, error: '書類番号が必要です' };
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hSh = ss.getSheetByName(SHEET_HEADER);
    const dSh = ss.getSheetByName(SHEET_DETAIL);

    const hLast = hSh.getLastRow();
    let hDeleted = false;
    if (hLast >= 2) {
      const vals = hSh.getRange(2, H['書類番号'] + 1, hLast - 1, 1).getValues();
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i][0] === docNo) { hSh.deleteRow(2 + i); hDeleted = true; }
      }
    }
    const dLast = dSh.getLastRow();
    let dDeletedCount = 0;
    if (dLast >= 2) {
      const vals = dSh.getRange(2, D['書類番号'] + 1, dLast - 1, 1).getValues();
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i][0] === docNo) { dSh.deleteRow(2 + i); dDeletedCount++; }
      }
    }
    if (!hDeleted && dDeletedCount === 0) return { ok: false, error: '該当する書類番号が見つかりませんでした' };

    const logSh = ss.getSheetByName(SHEET_DELETE_LOG);
    logSh.getRange(logSh.getLastRow() + 1, 1, 1, DELETE_LOG_COLS.length).setValues([[docNo, new Date()]]);
    logSh.getRange(logSh.getLastRow(), 2).setNumberFormat('yyyy-mm-dd hh:mm');

    return { ok: true, docNo: docNo, deletedDetailCount: dDeletedCount };
  } finally {
    lock.releaseLock();
  }
}
