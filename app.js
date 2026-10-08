// 위치 권한을 거부하거나 실패했을 때 사용할 기본 좌표 (서울시청)
const DEFAULT_POSITION = { lat: 37.5665, lng: 126.978 };

const locateBtn = document.getElementById("locate-btn");
const statusEl = document.getElementById("status");
const mapEl = document.getElementById("map");
const listEl = document.getElementById("place-list");
const radiusControl = document.getElementById("radius-control");
const chipsEl = document.getElementById("filter-chips");
const researchBtn = document.getElementById("research-btn");
const pickBtn = document.getElementById("pick-btn");
const pickResultEl = document.getElementById("pick-result");
const shareBox = document.getElementById("share-box");
const shareBtn = document.getElementById("share-btn");
const shareMsgEl = document.getElementById("share-msg");
const shareUrlInput = document.getElementById("share-url");
const sharedBanner = document.getElementById("shared-banner");
const sharedCountEl = document.getElementById("shared-count");
const sharedMsgEl = document.getElementById("shared-msg");
const importBtn = document.getElementById("import-btn");
const closeSharedBtn = document.getElementById("close-shared-btn");
const detailPanel = document.getElementById("detail-panel");
const detailTitleEl = document.getElementById("detail-title");
const detailOpenLink = document.getElementById("detail-open");
const detailFrame = document.getElementById("detail-frame");
const detailCloseBtn = document.getElementById("detail-close");

// 햄버거 가게 판별: 카카오 분류가 두 갈래로 나뉘어 있다
// - "음식점 > 양식 > 햄버거 > ..."           (수제버거 등)
// - "음식점 > 패스트푸드 > 맥도날드/버거킹/..." (분류에 '햄버거' 단어가 없음, 단 샌드위치 가게는 제외)
// - 써브웨이는 샌드위치지만 포함 ("음식점 > 패스트푸드 > 샌드위치 > 써브웨이")
// 분류가 애매한 곳("음식점 > 양식")은 가게 이름에 '버거'가 있으면 포함
function isBurger(place) {
  const c = place.category_name;
  return (
    c.includes("햄버거") ||
    (c.startsWith("음식점 > 패스트푸드") && (!c.includes("샌드위치") || c.includes("써브웨이"))) ||
    place.place_name.includes("버거")
  );
}

// 종류 필터 목록
// - category: 카테고리 검색 (FD6 = 음식점, CE7 = 카페)
// - keyword:  음식점(FD6) 안에서 키워드 검색 → 받은 뒤 분류 이름에 keyword가 있는 것만 남긴다
// - match:    (선택) 분류 이름만으로 거를 수 없을 때 쓰는 전용 판별 함수
// - extraKeywords: (선택) 함께 검색해서 결과를 합칠 추가 키워드
const FILTERS = [
  { label: "전체", category: "FD6" },
  { label: "한식", keyword: "한식" },
  { label: "중식", keyword: "중식" },
  { label: "일식", keyword: "일식" },
  { label: "양식", keyword: "양식" },
  { label: "분식", keyword: "분식" },
  { label: "치킨", keyword: "치킨" },
  { label: "햄버거", keyword: "햄버거", extraKeywords: ["써브웨이"], match: isBurger },
  { label: "카페", category: "CE7" },
  { label: "★ 즐겨찾기", favorites: true }, // 검색하지 않고 저장해 둔 곳을 보여준다
];

const MAX_RESULTS = 45; // 카카오 장소 검색이 주는 최대 개수 (15개 × 3페이지)

let map;              // 카카오 지도 객체
let myMarker;         // 내 위치 마커
let placeLabel;       // 선택한 식당 마커 위에 뜨는 이름표 (하나를 재사용)
// 화면에 표시 중인 음식점들: { place, position, item }
// - position: 지도에서 이 식당을 가리키는 좌표 (같은 건물에 묶인 식당은 묶음 마커의 좌표)
// (다시 검색할 때 마커를 지우고, 랜덤 추천에서 하나를 고르기 위해 보관)
let shownPlaces = [];
let mapItems = [];    // 지도에 올린 마커·묶음 마커들 (다시 검색할 때 지우기 위해 보관)
let groupPopup;       // 묶음 마커를 눌렀을 때 뜨는 식당 목록 팝업 (하나를 재사용)

// 이 거리(m) 안에 있는 식당들은 지도에서 마커 하나로 묶는다.
// 카카오는 식당 위치를 건물 기준 좌표로 줘서, 같은 건물 식당은 아무리 확대해도 겹치기 때문.
const GROUP_DISTANCE = 5;

// 현재 검색 조건 (화면에서 바뀌면 이 값을 고치고 runSearch()를 다시 부른다)
const search = {
  center: DEFAULT_POSITION, // 검색 중심 좌표
  centerLabel: "",          // 상태 문구에 쓸 중심 설명 ("내 위치", "지도 중심" 등)
  radius: 1000,             // 미터
  filter: FILTERS[0],
};
let searchSeq = 0; // 검색 요청 번호 (늦게 도착한 옛 결과를 버리기 위해)

function setStatus(message) {
  statusEl.textContent = message;
}

// ─── 1. 카카오 지도 SDK 불러오기 ────────────────────────────────

// <script> 태그를 동적으로 추가해 SDK를 로드한다.
// autoload=false: 스크립트만 받고 초기화는 kakao.maps.load()에서 직접 → 로드 완료 시점을 정확히 알 수 있음
// libraries=services: 다음 단계의 장소 검색(Places)에 필요한 라이브러리
function loadKakaoSdk(appKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=services`;
    script.onload = () => window.kakao.maps.load(resolve);
    script.onerror = () => reject(new Error("카카오 SDK를 불러오지 못했습니다. 키와 도메인 등록을 확인하세요."));
    document.head.appendChild(script);
  });
}

// ─── 2. 지도 그리기 ─────────────────────────────────────────────

function createMap({ lat, lng }) {
  map = new kakao.maps.Map(mapEl, {
    center: new kakao.maps.LatLng(lat, lng),
    level: 4, // 확대 수준: 숫자가 작을수록 확대 (1~14)
  });

  // 카카오 지도는 처음 만들 때의 영역 크기를 기억한다.
  // 창 크기 변경 등으로 지도 영역 크기가 바뀌면 relayout()으로 다시 맞춰줘야 회색 빈 곳이 생기지 않는다.
  new ResizeObserver(() => map.relayout()).observe(mapEl);

  placeLabel = createPlaceLabel();
  groupPopup = new kakao.maps.CustomOverlay({ yAnchor: 1, zIndex: 20, clickable: true }); // 이름표(10)보다 위
}

// 선택한 식당 이름표: [식당 이름  ✕]
// 카카오 기본 말풍선(InfoWindow)은 ✕가 이름을 가리고, ✕를 눌렀는지 알려주지 않아서
// 직접 만든 HTML을 지도 위에 띄우는 CustomOverlay를 쓴다.
function createPlaceLabel() {
  const el = document.createElement("div");
  el.className = "map-label";
  el.innerHTML = `<span class="map-label-name"></span><button class="map-label-close" aria-label="선택 해제">✕</button>`;
  el.querySelector(".map-label-close").addEventListener("click", deselectPlace);

  return new kakao.maps.CustomOverlay({
    content: el,
    yAnchor: 1,      // 이름표의 아래쪽 끝을 좌표에 맞춤 (CSS로 마커 머리 위까지 올림)
    zIndex: 10,      // 다른 마커들보다 위에
    clickable: true, // 이름표를 클릭해도 지도 클릭/드래그로 넘어가지 않게
  });
}

function showPlaceLabel(place, position) {
  // textContent는 글자 그대로 넣으므로 escapeHtml이 필요 없다
  placeLabel.getContent().querySelector(".map-label-name").textContent = place.place_name;
  placeLabel.setPosition(position);
  placeLabel.setMap(map);
}

function hidePlaceLabel() {
  placeLabel?.setMap(null);
}

// 선택 해제: 목록 펼침, 지도 이름표, 상세 패널을 한꺼번에 닫는다
// (목록 항목 다시 클릭, 이름표 ✕, 상세 패널 ✕ 모두 이 함수를 쓴다)
function deselectPlace() {
  listEl.querySelector(".active")?.classList.remove("active");
  hidePlaceLabel();
  hideGroupPopup();
  closeDetail();
}

// ─── 같은 자리 식당 묶기 ─────────────────────────────────────────

// 식당 목록 → [{ lat, lng, places: [...] }]  (GROUP_DISTANCE 안에 있는 식당끼리 한 묶음)
function groupByPosition(places) {
  const groups = [];
  places.forEach((place) => {
    const point = { lat: Number(place.y), lng: Number(place.x) };
    const group = groups.find((g) => distanceMeters(g, point) <= GROUP_DISTANCE);
    if (group) group.places.push(place);
    else groups.push({ ...point, places: [place] });
  });
  return groups;
}

// 숫자가 적힌 묶음 마커 (예: ⑤). 누르면 그 자리 식당 목록 팝업을 연다.
function createGroupMarker(position, entries) {
  const el = document.createElement("button");
  el.className = "group-marker";
  el.textContent = entries.length;
  el.title = entries.map(({ place }) => place.place_name).join(", "); // 마우스를 올리면 이름들
  el.addEventListener("click", () => openGroupPopup(position, entries));

  return new kakao.maps.CustomOverlay({ map, position, content: el, yAnchor: 1, zIndex: 2, clickable: true });
}

// 묶음 팝업: [주소 · N곳 ✕] + 식당 버튼 목록
// 가게 이름 등 외부 데이터는 textContent로만 넣는다 (HTML로 해석되지 않음)
function openGroupPopup(position, entries) {
  const el = document.createElement("div");
  el.className = "group-popup";

  const header = document.createElement("div");
  header.className = "group-popup-header";
  const title = document.createElement("span");
  const first = entries[0].place;
  title.textContent = `${first.road_address_name || first.address_name} · ${entries.length}곳`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "group-popup-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "닫기");
  closeBtn.addEventListener("click", hideGroupPopup);
  header.append(title, closeBtn);

  const list = document.createElement("ul");
  entries.forEach((entry) => {
    const btn = document.createElement("button");
    const name = document.createElement("span");
    name.textContent = entry.place.place_name;
    const category = document.createElement("span");
    category.className = "muted";
    category.textContent = shortCategory(entry.place.category_name);
    btn.append(name, category);
    if (entry.item.classList.contains("active")) btn.classList.add("active"); // 지금 선택된 식당 표시

    btn.addEventListener("click", () => {
      hideGroupPopup();
      // 이미 선택된 식당을 고르면 selectPlace가 '해제'해 버리므로 그때는 그대로 둔다
      if (!entry.item.classList.contains("active")) selectPlace(entry.place, entry.position, entry.item);
    });

    const li = document.createElement("li");
    li.append(btn);
    list.append(li);
  });

  el.append(header, list);
  groupPopup.setContent(el);
  groupPopup.setPosition(position);
  groupPopup.setMap(map);
}

function hideGroupPopup() {
  groupPopup?.setMap(null);
}

// 지도 중심을 옮기고 내 위치 마커를 표시 (마커는 하나만 유지)
function showMyLocation({ lat, lng }) {
  const position = new kakao.maps.LatLng(lat, lng);

  if (!myMarker) {
    myMarker = new kakao.maps.Marker({ map, position, title: "내 위치" });
  } else {
    myMarker.setPosition(position);
  }

  map.panTo(position); // 부드럽게 이동
}

// ─── 3. 주변 음식점 검색 ─────────────────────────────────────────

// 장소 검색은 한 번에 15개씩, 최대 3페이지(45개)까지 준다.
// 콜백 방식이라 Promise로 감싸고, 다음 페이지가 있으면 계속 받아서 합친다.
// start: 콜백을 받아 실제 검색을 시작하는 함수 (카테고리 검색이든 키워드 검색이든)
function fetchAllPages(start, logInfo) {
  const results = [];

  return new Promise((resolve, reject) => {
    start((data, status, pagination) => {
      if (status === kakao.maps.services.Status.ZERO_RESULT) {
        resolve(results);
        return;
      }
      if (status !== kakao.maps.services.Status.OK) {
        // 원인 파악을 위해 개발자 도구(F12) 콘솔에 상세 정보를 남긴다
        console.error("[장소 검색 실패]", { status, ...logInfo, 받은개수: results.length });

        // 일부 페이지라도 받았다면 그것만이라도 보여준다
        if (results.length > 0) resolve(results);
        else reject(new Error(`음식점 검색에 실패했습니다. (상태: ${status})`));
        return;
      }

      results.push(...data);
      if (pagination.hasNextPage) {
        pagination.nextPage(); // 같은 콜백이 다음 페이지 데이터로 다시 호출됨
      } else {
        resolve(results);
      }
    });
  });
}

async function searchPlaces({ lat, lng }, radius, filter) {
  const options = {
    location: new kakao.maps.LatLng(lat, lng), // 검색 중심
    radius,
    sort: kakao.maps.services.SortBy.DISTANCE, // 가까운 순
  };

  if (filter.category) {
    const places = new kakao.maps.services.Places();
    return fetchAllPages(
      (cb) => places.categorySearch(filter.category, cb, options),
      { lat, lng, filter: filter.label }
    );
  }

  // 키워드 검색 + 음식점 카테고리로 제한.
  // extraKeywords가 있으면 그 키워드로도 동시에 검색해서 결과를 합친다.
  // (예: '햄버거'로 검색하면 써브웨이가 안 나오므로 '써브웨이'로도 검색)
  const keywords = [filter.keyword, ...(filter.extraKeywords ?? [])];
  const lists = await Promise.all(
    keywords.map((keyword) => {
      const places = new kakao.maps.services.Places(); // 검색마다 따로 만들어 서로 섞이지 않게
      return fetchAllPages(
        (cb) => places.keywordSearch(keyword, cb, { ...options, category_group_code: "FD6" }),
        { lat, lng, keyword }
      );
    })
  );

  // 합치기: 같은 가게가 두 검색에 모두 나올 수 있으므로 장소 ID로 중복 제거 → 다시 가까운 순 정렬
  const byId = new Map();
  lists.flat().forEach((p) => byId.set(p.id, p));
  const merged = [...byId.values()].sort((a, b) => Number(a.distance) - Number(b.distance));

  // 키워드 검색은 메뉴 이름 등으로도 걸리므로(예: '치킨' → 베이커리),
  // 분류 이름("음식점 > 치킨 > ...")에 키워드가 들어 있는 곳만 남긴다.
  // 전용 판별 함수(match)가 있으면 그것을 대신 쓴다.
  return merged.filter(filter.match ?? ((p) => p.category_name.includes(filter.keyword)));
}

// ─── 즐겨찾기 (브라우저 localStorage에 저장) ─────────────────────

// localStorage: 브라우저에 문자열을 "키 → 값"으로 저장하는 공간.
// 새로고침이나 재부팅 후에도 남지만, 이 브라우저(이 기기)에서만 보인다.
const FAVORITES_KEY = "lunch-finder:favorites";

// 장소 ID → 장소 정보. Map을 쓰면 "이미 즐겨찾기했나?"를 바로 확인할 수 있다.
const favorites = loadFavorites();

function loadFavorites() {
  try {
    // 저장은 문자열만 되므로 JSON 문자열로 저장했다가 읽을 때 다시 객체로 바꾼다
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return new Map(list.map((p) => [p.id, p]));
  } catch {
    // 저장 공간이 막혀 있거나(시크릿 모드 등) 내용이 깨진 경우: 빈 목록으로 시작
    return new Map();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites.values()]));
  } catch {
    setStatus("즐겨찾기를 저장하지 못했습니다. (브라우저 저장 공간을 쓸 수 없음)");
  }
}

function isFavorite(place) {
  return favorites.has(place.id);
}

// 즐겨찾기 추가/해제. 거리(distance)는 검색 위치마다 달라지므로 저장하지 않는다.
function toggleFavorite(place) {
  if (isFavorite(place)) {
    favorites.delete(place.id);
  } else {
    const { id, place_name, category_name, road_address_name, address_name, phone, x, y } = place;
    favorites.set(id, { id, place_name, category_name, road_address_name, address_name, phone, x, y });
  }
  saveFavorites();
}

// 두 좌표 사이의 직선 거리(m) — 하버사인 공식 (지구를 반지름 6371km 구로 보고 계산)
function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// 장소 목록(즐겨찾기, 공유받은 목록)에 현재 검색 중심 기준 거리를 붙여 가까운 순으로
function placesNear(list, center) {
  return list
    .map((p) => ({ ...p, distance: distanceMeters(center, { lat: Number(p.y), lng: Number(p.x) }) }))
    .sort((a, b) => a.distance - b.distance);
}

// ─── 즐겨찾기 공유 링크 ──────────────────────────────────────────

// 링크 안에 즐겨찾기 정보를 통째로 담는다. 서버 없이 공유할 수 있는 대신, 보낸 시점의 복사본이다.
// 주소의 # 뒷부분(해시)은 서버로 전송되지 않으므로, 목록 내용이 GitHub 서버 기록에 남지 않는다.
const SHARE_PREFIX = "#share=";
const SHARE_MAX = 100; // 받은 링크에서 읽을 최대 개수 (비정상적으로 긴 링크 방지)

// 목록 → 링크용 문자열
// 1) 필요한 값만 배열로 압축 → 2) JSON 문자열 → 3) UTF-8 바이트 → 4) base64url (주소에 넣어도 안전한 문자만)
function encodeShare(list) {
  const rows = list.map((p) => [
    p.id,
    p.place_name,
    p.category_name,
    p.road_address_name || p.address_name,
    p.phone || "",
    Number(p.x).toFixed(6), // 좌표는 소수점 6자리(약 10cm)면 충분
    Number(p.y).toFixed(6),
  ]);
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, p: rows }));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 링크용 문자열 → 목록. 남이 만든 링크일 수 있으므로 형식을 꼼꼼히 확인하고, 이상하면 null.
function decodeShare(encoded) {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data?.v !== 1 || !Array.isArray(data.p)) return null;

    const isText = (s) => typeof s === "string" && s.length <= 200;
    const list = data.p
      .slice(0, SHARE_MAX)
      .filter(
        (r) =>
          Array.isArray(r) &&
          /^\d+$/.test(r[0]) && // 카카오 장소 ID는 숫자 (링크 주소에 들어가므로 엄격하게)
          [r[1], r[2], r[3], r[4]].every(isText) &&
          Number.isFinite(Number(r[5])) &&
          Number.isFinite(Number(r[6]))
      )
      .map(([id, place_name, category_name, address, phone, x, y]) => ({
        id, place_name, category_name, phone,
        road_address_name: address,
        address_name: address,
        x: String(x),
        y: String(y),
      }));
    return list.length > 0 ? list : null;
  } catch {
    return null; // base64나 JSON이 깨진 링크
  }
}

// 공유 링크로 열었을 때 보여줄 목록 (필터 칩에는 없는 특별한 보기)
let sharedPlaces = [];
const SHARED_FILTER = { label: "공유받은 목록", shared: true };

function readSharedFromUrl() {
  if (!location.hash.startsWith(SHARE_PREFIX)) return null;
  return decodeShare(location.hash.slice(SHARE_PREFIX.length));
}

// 주소창에서 #share=... 를 지운다 (새로고침해도 다시 공유 화면이 뜨지 않게).
// replaceState는 페이지를 새로 불러오지 않고 주소만 바꾼다.
function clearShareHash() {
  if (location.hash.startsWith(SHARE_PREFIX)) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function enterSharedView(list) {
  sharedPlaces = list;
  search.filter = SHARED_FILTER;
  chipsEl.querySelector(".active")?.classList.remove("active"); // 어떤 필터 칩도 선택 안 된 상태
  sharedCountEl.textContent = list.length;
  sharedMsgEl.hidden = true;
  importBtn.disabled = false;
}

async function copyShareLink() {
  const url = location.origin + location.pathname + SHARE_PREFIX + encodeShare([...favorites.values()]);
  try {
    await navigator.clipboard.writeText(url);
    shareMsgEl.textContent = `링크를 복사했어요 (${favorites.size}곳). 카톡 등에 붙여넣어 보내세요.`;
    shareUrlInput.hidden = true;
  } catch {
    // 클립보드 권한이 막힌 경우: 링크를 직접 보여주고 선택해 두기
    shareMsgEl.textContent = "자동 복사가 막혀 있어요. 아래 링크를 복사해 주세요.";
    shareUrlInput.value = url;
    shareUrlInput.hidden = false;
    shareUrlInput.select();
  }
  shareMsgEl.hidden = false;
}

function importShared() {
  let added = 0;
  sharedPlaces.forEach((p) => {
    if (!isFavorite(p)) {
      toggleFavorite(p); // 없는 것만 추가
      added++;
    }
  });
  const skipped = sharedPlaces.length - added;
  sharedMsgEl.textContent =
    added > 0
      ? `${added}곳을 내 즐겨찾기에 추가했어요.` + (skipped > 0 ? ` (이미 있던 ${skipped}곳 제외)` : "")
      : "모두 이미 내 즐겨찾기에 있어요.";
  sharedMsgEl.hidden = false;
  importBtn.disabled = true;
  runSearch(); // ☆ → ★ 표시 갱신
}

// ─── 4. 검색 결과 표시 (마커 + 목록) ─────────────────────────────

function clearPlaces() {
  mapItems.forEach((item) => item.setMap(null)); // 지도에서 마커·묶음 마커 제거
  mapItems = [];
  shownPlaces = [];
  hideGroupPopup();
  listEl.innerHTML = "";
  pickResultEl.hidden = true; // 목록이 바뀌면 이전 추천 결과도 숨김
  hidePlaceLabel();           // 선택했던 식당이 목록에서 사라지므로 이름표와
  closeDetail();              // 상세 패널도 닫음
}

// ─── 상세 정보 패널 ─────────────────────────────────────────────

// 카카오맵 장소 페이지를 iframe으로 띄운다.
// (공식 API가 아니라 카카오 페이지를 그대로 보여주는 방식이라, 카카오가 막으면 안 보일 수 있다
//  → 그래서 '새 탭에서 열기' 링크를 항상 함께 둔다)
function openDetail(place) {
  const url = `https://place.map.kakao.com/${encodeURIComponent(place.id)}`;
  detailTitleEl.textContent = place.place_name;
  detailOpenLink.href = url;
  if (detailFrame.src !== url) detailFrame.src = url; // 같은 곳이면 다시 불러오지 않음
  detailPanel.hidden = false;
  // 패널이 열리면 지도 폭이 줄어든다. ResizeObserver도 relayout하지만 그건 조금 뒤에 실행되므로,
  // 바로 다음에 하는 지도 이동(panTo)이 새 크기 기준이 되도록 여기서 즉시 맞춘다.
  map.relayout();
}

function closeDetail() {
  detailPanel.hidden = true;
  // 닫을 때 비워두면 다음에 열 때 이전 가게가 잠깐 보이는 일이 없다
  detailFrame.removeAttribute("src");
}

// "음식점 > 한식 > 국밥" → "국밥" (가장 구체적인 분류만 표시)
function shortCategory(categoryName) {
  return categoryName.split(" > ").pop();
}

function formatDistance(meters) {
  const m = Number(meters);
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// 마커나 목록 항목을 클릭했을 때: 이름표 띄우고, 목록 항목을 펼쳐 상세 정보 표시
function selectPlace(place, position, itemEl) {
  // 이미 펼쳐진 항목을 다시 누르면 접는다
  if (itemEl.classList.contains("active")) {
    deselectPlace();
    return;
  }

  hideGroupPopup();
  showPlaceLabel(place, position);

  listEl.querySelector(".active")?.classList.remove("active");
  itemEl.classList.add("active"); // CSS에서 .active일 때만 상세 영역을 보여준다
  itemEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

  openDetail(place);
  map.panTo(position); // 패널이 열려 줄어든 지도 기준으로 가운데 이동
}

// 외부 데이터를 HTML에 넣기 전에 특수문자를 바꿔서 의도치 않은 태그 실행을 막는다.
// 따옴표까지 바꿔야 href="..." 같은 속성 값 안에 넣어도 안전하다.
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 상세 정보 영역 HTML (항목을 펼쳤을 때 보임)
// 카카오맵 상세 페이지·길찾기는 오른쪽 상세 패널에서 보므로 여기에는 기본 정보만 둔다
function detailHtml(place) {
  // 전화번호: "02-123-4567" → tel:021234567 (휴대폰에서 누르면 바로 전화)
  const phone = place.phone
    ? `<a href="tel:${escapeHtml(place.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(place.phone)}</a>`
    : `<span class="muted">전화번호 정보 없음</span>`;

  // 지번 주소는 도로명 주소와 다를 때만 함께 표시
  const jibun =
    place.road_address_name && place.address_name !== place.road_address_name
      ? `<br /><span class="muted">지번 ${escapeHtml(place.address_name)}</span>`
      : "";

  return `
    <div class="place-detail">
      <dl>
        <dt>분류</dt><dd>${escapeHtml(place.category_name.replace(/ > /g, " › "))}</dd>
        <dt>주소</dt><dd>${escapeHtml(place.road_address_name || place.address_name)}${jibun}</dd>
        <dt>전화</dt><dd>${phone}</dd>
      </dl>
    </div>
  `;
}

function renderPlaces(places) {
  clearPlaces();

  // 모든 마커가 화면에 들어오도록 범위를 계산 (검색 중심 포함)
  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(new kakao.maps.LatLng(search.center.lat, search.center.lng));

  // 1) 같은 자리 식당끼리 묶고, 식당마다 지도에서 가리킬 좌표(묶음 좌표)를 정한다
  //    (카카오 API는 x = 경도(lng), y = 위도(lat) 로 준다 — 순서 주의!)
  const groups = groupByPosition(places);
  const positionById = new Map();
  groups.forEach((group) => {
    group.position = new kakao.maps.LatLng(group.lat, group.lng);
    group.places.forEach((place) => positionById.set(place.id, group.position));
    bounds.extend(group.position);
  });

  // 2) 목록 항목 만들기 (가까운 순 그대로)
  places.forEach((place) => {
    const position = positionById.get(place.id);

    const item = document.createElement("li");
    item.className = "place-item";
    item.innerHTML = `
      <button class="fav-btn" aria-label="즐겨찾기"></button>
      <span class="place-distance">${formatDistance(place.distance)}</span>
      <p class="place-name">${escapeHtml(place.place_name)}</p>
      <p class="place-meta">${escapeHtml(shortCategory(place.category_name))} · ${escapeHtml(place.road_address_name || place.address_name)}</p>
      ${detailHtml(place)}
    `;
    listEl.appendChild(item);

    // ☆/★ 버튼: 누를 때마다 즐겨찾기 추가/해제하고 모양을 바꾼다
    const favBtn = item.querySelector(".fav-btn");
    const paintFav = () => {
      const on = isFavorite(place);
      favBtn.textContent = on ? "★" : "☆";
      favBtn.classList.toggle("on", on);
      favBtn.title = on ? "즐겨찾기 해제" : "즐겨찾기 추가";
    };
    paintFav();
    favBtn.addEventListener("click", () => {
      toggleFavorite(place);
      if (search.filter.favorites) {
        // 즐겨찾기 화면에서 해제하면 목록에서 바로 빠지도록 다시 그린다.
        // 이때는 보던 위치를 유지해야 하므로 스크롤 위치를 기억했다가 되돌린다.
        // (즐겨찾기 보기는 검색을 기다리지 않아서 runSearch()가 즉시 다시 그린다)
        const scrollTop = listEl.scrollTop;
        runSearch();
        listEl.scrollTop = scrollTop;
      } else {
        paintFav();
      }
    });

    item.addEventListener("click", (e) => {
      // 링크(전화, 상세보기, 길찾기)나 ☆ 버튼을 누른 건 항목 접기/펼치기로 취급하지 않음
      if (e.target.closest("a, button")) return;
      selectPlace(place, position, item);
    });

    shownPlaces.push({ place, position, item });
  });

  // 3) 지도에 마커 올리기: 혼자 있으면 일반 마커, 여럿이 겹치면 숫자 묶음 마커
  const entryById = new Map(shownPlaces.map((entry) => [entry.place.id, entry]));
  groups.forEach((group) => {
    const entries = group.places.map((place) => entryById.get(place.id));

    if (entries.length === 1) {
      const { place, item } = entries[0];
      const marker = new kakao.maps.Marker({ map, position: group.position, title: place.place_name });
      kakao.maps.event.addListener(marker, "click", () => selectPlace(place, group.position, item));
      mapItems.push(marker);
    } else {
      mapItems.push(createGroupMarker(group.position, entries));
    }
  });

  if (places.length > 0) map.setBounds(bounds);
  pickBtn.disabled = places.length === 0; // 고를 게 없으면 추천 버튼 비활성화

  // 새 목록은 맨 위부터 보이게.
  // (지우고 다시 채우는 게 한 번에 일어나서 브라우저가 이전 스크롤 위치를 그대로 유지하므로 직접 초기화)
  listEl.scrollTop = 0;
}

// ─── 랜덤 메뉴 추천 ─────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomItem(array) {
  // Math.random(): 0 이상 1 미만의 실수 → 배열 길이를 곱하고 내림하면 0 ~ (길이-1) 사이의 정수
  return array[Math.floor(Math.random() * array.length)];
}

// "음식점 > 술집 > 호프,요리주점" 처럼 분류의 두 번째 칸이 '술집'이면 술집
// (호프, 이자카야, 포차, 와인바 등이 모두 이 아래에 있다)
function isBar(place) {
  return place.category_name.split(" > ")[1] === "술집";
}

async function pickRandomPlace() {
  // 지금 보고 있는 목록을 기억해 둔다. 룰렛이 도는 사이 다시 검색되면 이 목록은 낡은 것이 된다.
  const list = shownPlaces;

  // 메뉴 추천이므로 술집은 후보에서 뺀다 (목록과 지도에는 그대로 보임)
  const meals = list.filter(({ place }) => !isBar(place));
  if (meals.length === 0) {
    pickResultEl.hidden = false;
    pickResultEl.textContent = "추천할 식당이 없어요. 반경을 넓히거나 다른 종류를 골라보세요.";
    return;
  }

  // 지금 펼쳐져 있는 곳은 후보에서 빼서, 연속으로 같은 곳이 뽑히지 않게 한다
  const candidates = meals.length > 1 ? meals.filter(({ item }) => !item.classList.contains("active")) : meals;
  const picked = randomItem(candidates);

  pickBtn.disabled = true;
  pickResultEl.hidden = false;
  pickResultEl.classList.add("spinning");

  // 룰렛 연출: 이름을 빠르게 바꾸다가 점점 느려지게 (대기 시간을 조금씩 늘림)
  const TICKS = 14;
  for (let i = 0; i < TICKS; i++) {
    // 룰렛이 도는 동안 필터 변경 등으로 목록이 바뀌었다면 중단하고 결과를 버린다
    // (버튼 활성화 여부는 새 목록을 그린 renderPlaces가 정해 준다)
    if (shownPlaces !== list) {
      pickResultEl.classList.remove("spinning");
      return;
    }
    pickResultEl.textContent = randomItem(meals).place.place_name; // 룰렛에도 술집은 안 나오게
    await sleep(40 + i * i * 2); // 40ms → 약 400ms 로 점점 느려짐
  }
  if (shownPlaces !== list) {
    pickResultEl.classList.remove("spinning");
    return;
  }

  pickResultEl.classList.remove("spinning");
  pickResultEl.innerHTML =
    `오늘은 <strong>${escapeHtml(picked.place.place_name)}</strong> 어때요?<br />` +
    `<span class="muted">${escapeHtml(shortCategory(picked.place.category_name))} · ${formatDistance(picked.place.distance)}</span>`;

  // 뽑힌 곳을 지도와 목록에서 펼쳐 보여준다 (이미 펼쳐진 상태면 selectPlace가 접어버리므로 먼저 확인)
  if (!picked.item.classList.contains("active")) {
    selectPlace(picked.place, picked.position, picked.item);
  }
  pickBtn.disabled = false;
}

function formatRadius(meters) {
  return meters < 1000 ? `${meters}m` : `${meters / 1000}km`;
}

// 현재 검색 조건(search)으로 검색 → 화면 표시까지 한 번에
async function runSearch() {
  // 필터를 빠르게 연달아 누르면 응답 순서가 뒤바뀔 수 있다.
  // 요청마다 번호를 붙이고, 가장 마지막 요청의 결과만 화면에 그린다.
  const seq = ++searchSeq;
  const { center, centerLabel, radius, filter } = search;

  researchBtn.hidden = true;
  // 즐겨찾기·공유받은 목록은 반경과 상관없이 전부 보여주므로 반경 버튼을 숨긴다
  radiusControl.hidden = Boolean(filter.favorites || filter.shared);
  sharedBanner.hidden = !filter.shared;
  shareMsgEl.hidden = true;
  shareUrlInput.hidden = true;
  if (!filter.shared) clearShareHash(); // 공유 화면을 벗어나면 주소창도 정리

  // 즐겨찾기: 카카오 검색 없이 저장된 목록을 바로 그린다
  if (filter.favorites) {
    const places = placesNear([...favorites.values()], center);
    renderPlaces(places);
    shareBox.hidden = places.length === 0; // 공유할 게 있을 때만 공유 버튼
    setStatus(
      places.length > 0
        ? `즐겨찾기 ${places.length}곳 · ${centerLabel} 기준 가까운 순`
        : "아직 즐겨찾기한 곳이 없어요. 목록에서 ☆를 눌러 추가해 보세요."
    );
    return;
  }
  shareBox.hidden = true;

  // 공유받은 목록: 링크에 담겨 온 장소들을 그린다
  if (filter.shared) {
    const places = placesNear(sharedPlaces, center);
    renderPlaces(places);
    setStatus(`공유받은 ${places.length}곳 · ${centerLabel} 기준 가까운 순`);
    return;
  }

  setStatus(`${filter.label} 검색 중...`);

  try {
    const places = await searchPlaces(center, radius, filter);
    if (seq !== searchSeq) return; // 그 사이 새 검색이 시작됨 → 이 결과는 버림

    renderPlaces(places);
    // 검색 한 번에 최대 45곳까지만 오므로, 그 이상이면 먼 곳은 빠져 있을 수 있다
    const capped = places.length >= MAX_RESULTS ? " (가까운 곳 위주로 일부만 표시)" : "";
    setStatus(`${centerLabel} 반경 ${formatRadius(radius)} · ${filter.label} ${places.length}곳${capped}`);
  } catch (err) {
    if (seq === searchSeq) setStatus(err.message);
  }
}

// ─── 5. 검색 조건 UI (반경, 종류, 재검색) ───────────────────────

function renderFilterChips() {
  FILTERS.forEach((filter) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = filter.label;
    if (filter === search.filter) chip.classList.add("active");

    chip.addEventListener("click", () => {
      chipsEl.querySelector(".active")?.classList.remove("active");
      chip.classList.add("active");
      search.filter = filter;
      runSearch();
    });

    chipsEl.appendChild(chip);
  });
}

function setupControls() {
  renderFilterChips();
  pickBtn.addEventListener("click", pickRandomPlace);

  // 상세 패널 ✕: 펼쳐진 목록 항목과 지도 이름표도 함께 닫는다
  detailCloseBtn.addEventListener("click", deselectPlace);

  // 즐겨찾기 공유
  shareBtn.addEventListener("click", copyShareLink);
  importBtn.addEventListener("click", importShared);
  closeSharedBtn.addEventListener("click", () => chipsEl.querySelector(".chip").click()); // '전체'로 돌아가기

  // 이미 열려 있는 탭의 주소창에 공유 링크를 붙여넣은 경우(해시만 바뀜 → 새로고침 안 됨)
  window.addEventListener("hashchange", () => {
    const list = readSharedFromUrl();
    if (list) {
      enterSharedView(list);
      runSearch();
    }
  });

  // 반경 버튼: 버튼마다 따로 연결하지 않고 묶음(radiusControl)에 한 번만 연결한다 (이벤트 위임)
  radiusControl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-radius]");
    if (!btn || btn.classList.contains("active")) return; // 이미 선택된 반경이면 다시 검색하지 않음

    radiusControl.querySelector(".active")?.classList.remove("active");
    btn.classList.add("active");
    search.radius = Number(btn.dataset.radius); // data-radius="2000" → btn.dataset.radius === "2000"
    runSearch();
  });

  // 사용자가 지도를 끌어서 옮기면 '이 지역에서 재검색' 버튼을 보여준다.
  // (setBounds 같은 코드에 의한 이동은 dragend가 발생하지 않음)
  kakao.maps.event.addListener(map, "dragend", () => {
    researchBtn.hidden = false;
  });

  // 지도 빈 곳을 누르면 묶음 팝업 닫기
  // (마커·묶음 마커·팝업 자체를 누른 건 지도 클릭으로 전달되지 않음)
  kakao.maps.event.addListener(map, "click", hideGroupPopup);

  researchBtn.addEventListener("click", () => {
    const c = map.getCenter();
    search.center = { lat: c.getLat(), lng: c.getLng() };
    search.centerLabel = "지도 중심";
    runSearch();
  });
}

// ─── 6. 현재 위치 얻기 (1단계에서 만든 부분) ────────────────────

// 브라우저의 Geolocation API를 Promise로 감싸서 async/await로 쓸 수 있게 함
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("이 브라우저는 위치 정보를 지원하지 않습니다."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      {
        enableHighAccuracy: true, // 가능하면 GPS 사용 (모바일)
        timeout: 10000,           // 10초 안에 못 찾으면 실패 처리
        maximumAge: 60000,        // 1분 이내에 얻은 위치는 재사용
      }
    );
  });
}

// Geolocation 오류 코드를 사람이 읽을 수 있는 메시지로 변환
function describeGeoError(err) {
  switch (err.code) {
    case 1: return "위치 권한이 거부되었습니다.";
    case 2: return "위치를 확인할 수 없습니다.";
    case 3: return "위치 요청 시간이 초과되었습니다.";
    default: return err.message;
  }
}

async function handleLocate() {
  locateBtn.disabled = true;
  setStatus("위치를 찾는 중...");

  // 위치를 얻는 데 실패하면 기본 위치로 대신 검색한다
  try {
    search.center = await getCurrentPosition();
    search.centerLabel = "내 위치";
  } catch (err) {
    search.center = DEFAULT_POSITION;
    search.centerLabel = `${describeGeoError(err)} 서울시청(기본 위치)`;
  }

  showMyLocation(search.center);
  await runSearch();
  locateBtn.disabled = false;
}

// ─── 시작 ──────────────────────────────────────────────────────

async function init() {
  // 파일을 더블클릭해서 file:// 로 열면 출처(Origin)가 없어 카카오 API가 401로 거부한다
  if (location.protocol === "file:") {
    setStatus("파일을 직접 열면 동작하지 않습니다. 로컬 서버를 실행한 뒤 http://localhost:5173 으로 접속하세요.");
    return;
  }

  const appKey = window.APP_CONFIG?.KAKAO_JS_KEY;
  if (!appKey || appKey.startsWith("여기에")) {
    setStatus("config.js에 카카오 JavaScript 키를 넣어주세요.");
    return;
  }

  locateBtn.disabled = true; // SDK 로드 전에는 버튼 비활성화
  try {
    await loadKakaoSdk(appKey);
  } catch (err) {
    setStatus(err.message);
    return;
  }

  createMap(DEFAULT_POSITION);
  setupControls();
  locateBtn.addEventListener("click", handleLocate);

  // 공유 링크로 들어왔다면 공유받은 목록 보기로 시작
  const shared = readSharedFromUrl();
  if (shared) enterSharedView(shared);
  // 주소는 공유 링크 모양인데 내용을 못 읽었다면 깨진 링크 (검색하면서 주소가 정리되므로 미리 확인)
  const brokenLink = !shared && location.hash.startsWith(SHARE_PREFIX);

  // 페이지가 열리면 바로 내 위치를 한 번 찾아본다 (그 위치 기준으로 검색/거리 계산)
  await handleLocate();

  // handleLocate가 상태 문구를 덮어쓰므로 그 뒤에 알려준다
  if (brokenLink) setStatus("공유 링크가 올바르지 않아 일반 검색으로 열었어요.");
}

init();
