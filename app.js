// 위치 권한을 거부하거나 실패했을 때 사용할 기본 좌표 (서울시청)
const DEFAULT_POSITION = { lat: 37.5665, lng: 126.978 };

const locateBtn = document.getElementById("locate-btn");
const statusEl = document.getElementById("status");
const mapEl = document.getElementById("map");
const listEl = document.getElementById("place-list");
const radiusSelect = document.getElementById("radius-select");
const chipsEl = document.getElementById("filter-chips");
const researchBtn = document.getElementById("research-btn");
const pickBtn = document.getElementById("pick-btn");
const pickResultEl = document.getElementById("pick-result");

// 종류 필터 목록
// - category: 카테고리 검색 (FD6 = 음식점, CE7 = 카페)
// - keyword:  음식점(FD6) 안에서 키워드 검색 → 받은 뒤 분류 이름에 keyword가 있는 것만 남긴다
const FILTERS = [
  { label: "전체", category: "FD6" },
  { label: "한식", keyword: "한식" },
  { label: "중식", keyword: "중식" },
  { label: "일식", keyword: "일식" },
  { label: "양식", keyword: "양식" },
  { label: "분식", keyword: "분식" },
  { label: "치킨", keyword: "치킨" },
  { label: "카페", category: "CE7" },
];

const MAX_RESULTS = 45; // 카카오 장소 검색이 주는 최대 개수 (15개 × 3페이지)

let map;              // 카카오 지도 객체
let myMarker;         // 내 위치 마커
let infoWindow;       // 마커 위 말풍선 (하나를 재사용)
// 화면에 표시 중인 음식점들: { place, marker, item }
// (다시 검색할 때 마커를 지우고, 랜덤 추천에서 하나를 고르기 위해 보관)
let shownPlaces = [];

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
function searchPlaces({ lat, lng }, radius, filter) {
  const places = new kakao.maps.services.Places();
  const results = [];

  const options = {
    location: new kakao.maps.LatLng(lat, lng), // 검색 중심
    radius,
    sort: kakao.maps.services.SortBy.DISTANCE, // 가까운 순
  };

  return new Promise((resolve, reject) => {
    const callback = (data, status, pagination) => {
      if (status === kakao.maps.services.Status.ZERO_RESULT) {
        resolve(results);
        return;
      }
      if (status !== kakao.maps.services.Status.OK) {
        // 원인 파악을 위해 개발자 도구(F12) 콘솔에 상세 정보를 남긴다
        console.error("[장소 검색 실패]", { status, lat, lng, filter: filter.label, 받은개수: results.length });

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
    };

    if (filter.category) {
      places.categorySearch(filter.category, callback, options);
    } else {
      // 키워드 검색 + 음식점 카테고리로 제한
      places.keywordSearch(filter.keyword, callback, { ...options, category_group_code: "FD6" });
    }
  }).then((list) =>
    // 키워드 검색은 메뉴 이름 등으로도 걸리므로(예: '치킨' → 베이커리),
    // 분류 이름("음식점 > 치킨 > ...")에 키워드가 들어 있는 곳만 남긴다
    filter.keyword ? list.filter((p) => p.category_name.includes(filter.keyword)) : list
  );
}

// ─── 4. 검색 결과 표시 (마커 + 목록) ─────────────────────────────

function clearPlaces() {
  shownPlaces.forEach(({ marker }) => marker.setMap(null)); // 지도에서 제거
  shownPlaces = [];
  listEl.innerHTML = "";
  infoWindow?.close();
  pickResultEl.hidden = true; // 목록이 바뀌면 이전 추천 결과도 숨김
}

// "음식점 > 한식 > 국밥" → "국밥" (가장 구체적인 분류만 표시)
function shortCategory(categoryName) {
  return categoryName.split(" > ").pop();
}

function formatDistance(meters) {
  const m = Number(meters);
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// 마커나 목록 항목을 클릭했을 때: 말풍선 띄우고, 목록 항목을 펼쳐 상세 정보 표시
function selectPlace(place, marker, itemEl) {
  // 이미 펼쳐진 항목을 다시 누르면 접는다
  if (itemEl.classList.contains("active")) {
    itemEl.classList.remove("active");
    infoWindow.close();
    return;
  }

  infoWindow.setContent(`<div class="info-window">${escapeHtml(place.place_name)}</div>`);
  infoWindow.open(map, marker);
  map.panTo(marker.getPosition());

  listEl.querySelector(".active")?.classList.remove("active");
  itemEl.classList.add("active"); // CSS에서 .active일 때만 상세 영역을 보여준다
  itemEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
function detailHtml(place) {
  const id = encodeURIComponent(place.id);
  // 카카오맵 링크: 장소 ID만 있으면 상세 페이지 / 길찾기로 바로 연결된다
  const detailUrl = `https://place.map.kakao.com/${id}`;
  const routeUrl = `https://map.kakao.com/link/to/${id}`;

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
      <div class="place-links">
        <!-- target="_blank": 새 탭에서 열기 / rel="noopener": 새 탭이 이 페이지를 조작하지 못하게 -->
        <a class="link-btn" href="${detailUrl}" target="_blank" rel="noopener">카카오맵 상세보기</a>
        <a class="link-btn primary" href="${routeUrl}" target="_blank" rel="noopener">길찾기</a>
      </div>
    </div>
  `;
}

function renderPlaces(places) {
  clearPlaces();
  if (!infoWindow) infoWindow = new kakao.maps.InfoWindow({ removable: true });

  // 모든 마커가 화면에 들어오도록 범위를 계산 (검색 중심 포함)
  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(new kakao.maps.LatLng(search.center.lat, search.center.lng));

  places.forEach((place) => {
    // 카카오 API는 x = 경도(lng), y = 위도(lat) 로 준다 (순서 주의!)
    const position = new kakao.maps.LatLng(place.y, place.x);
    const marker = new kakao.maps.Marker({ map, position, title: place.place_name });
    bounds.extend(position);

    const item = document.createElement("li");
    item.className = "place-item";
    item.innerHTML = `
      <span class="place-distance">${formatDistance(place.distance)}</span>
      <p class="place-name">${escapeHtml(place.place_name)}</p>
      <p class="place-meta">${escapeHtml(shortCategory(place.category_name))} · ${escapeHtml(place.road_address_name || place.address_name)}</p>
      ${detailHtml(place)}
    `;
    listEl.appendChild(item);

    item.addEventListener("click", (e) => {
      // 상세 영역 안의 링크(전화, 상세보기, 길찾기)를 누른 건 항목 접기/펼치기로 취급하지 않음
      if (e.target.closest("a")) return;
      selectPlace(place, marker, item);
    });
    kakao.maps.event.addListener(marker, "click", () => selectPlace(place, marker, item));

    shownPlaces.push({ place, marker, item });
  });

  if (places.length > 0) map.setBounds(bounds);
  pickBtn.disabled = places.length === 0; // 고를 게 없으면 추천 버튼 비활성화
}

// ─── 랜덤 메뉴 추천 ─────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomItem(array) {
  // Math.random(): 0 이상 1 미만의 실수 → 배열 길이를 곱하고 내림하면 0 ~ (길이-1) 사이의 정수
  return array[Math.floor(Math.random() * array.length)];
}

async function pickRandomPlace() {
  // 지금 보고 있는 목록을 기억해 둔다. 룰렛이 도는 사이 다시 검색되면 이 목록은 낡은 것이 된다.
  const list = shownPlaces;
  if (list.length === 0) return;

  // 지금 펼쳐져 있는 곳은 후보에서 빼서, 연속으로 같은 곳이 뽑히지 않게 한다
  const candidates = list.length > 1 ? list.filter(({ item }) => !item.classList.contains("active")) : list;
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
    pickResultEl.textContent = randomItem(list).place.place_name;
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
    selectPlace(picked.place, picked.marker, picked.item);
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
  setStatus(`${filter.label} 검색 중...`);

  try {
    const places = await searchPlaces(center, radius, filter);
    if (seq !== searchSeq) return; // 그 사이 새 검색이 시작됨 → 이 결과는 버림

    renderPlaces(places);
    const capped = places.length >= MAX_RESULTS ? " (가까운 순 최대 45곳)" : "";
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

  radiusSelect.addEventListener("change", () => {
    search.radius = Number(radiusSelect.value);
    runSearch();
  });

  // 사용자가 지도를 끌어서 옮기면 '이 지역에서 재검색' 버튼을 보여준다.
  // (setBounds 같은 코드에 의한 이동은 dragend가 발생하지 않음)
  kakao.maps.event.addListener(map, "dragend", () => {
    researchBtn.hidden = false;
  });

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

  // 페이지가 열리면 바로 내 위치를 한 번 찾아본다
  handleLocate();
}

init();
