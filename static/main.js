// =========================
// 전역 변수 선언 (공유 객체)
// =========================
let map;
let geocoder;
let ps;
let polyline;
let markers = [];
let lastRests = [];
let infowindow = null;
let isSelectingAutocomplete = false;

const addressCache = {};

// =========================
// 초기화 및 라이브러리 로드 보장
// =========================
window.onload = function () {
    // HTML에 autoload=false를 사용했으므로 반드시 load 콜백 내부에서 초기화합니다.
    kakao.maps.load(function () {
        const container = document.getElementById("map");
        if (!container) {
            console.error("지도를 표시할 div(id='map')를 찾을 수 없습니다.");
            return;
        }

        // 1. 지도 생성
        map = new kakao.maps.Map(container, {
            center: new kakao.maps.LatLng(36.5, 127.8),
            level: 13,
        });

        // 2. 서비스 객체 초기화 (이 시점에는 라이브러리가 로드되었음이 보장됨)
        geocoder = new kakao.maps.services.Geocoder();
        ps = new kakao.maps.services.Places();

        // 3. 리스너 등록
        addInputListeners();
        setupOutsideClick();
        
        console.log("카카오 지도 및 라이브러리 로드 완료");
    });
};

function addInputListeners() {
    const startInput = document.getElementById("start");
    const endInput = document.getElementById("end");
    if (startInput) startInput.addEventListener("input", () => autoComplete("start"));
    if (endInput) endInput.addEventListener("input", () => autoComplete("end"));
}

function setupOutsideClick() {
    document.addEventListener("click", (e) => {
        ["start", "end"].forEach((type) => {
            const input = document.getElementById(type);
            const box = document.getElementById(`autocomplete-${type}`);
            if (input && box && !input.contains(e.target) && !box.contains(e.target)) {
                box.classList.add("hidden");
            }
        });
    });
}

// =========================
// 장소 검색 및 자동완성
// =========================
function autoComplete(type) {
    if (isSelectingAutocomplete) return;
    const input = document.getElementById(type);
    const keyword = input.value.trim();
    const box = document.getElementById(`autocomplete-${type}`);

    if (!keyword) {
        box.classList.add("hidden");
        return;
    }

    // 전역 ps 객체가 생성되지 않았을 경우 대비
    if (!ps) return;

    ps.keywordSearch(keyword, (data, status) => {
        if (status !== kakao.maps.services.Status.OK) {
            box.classList.add("hidden");
            return;
        }
        box.innerHTML = "";
        box.classList.remove("hidden");
        data.forEach((place) => {
            const item = document.createElement("div");
            item.className = "p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors";
            item.innerHTML = `<div class="font-bold text-sm text-gray-800">${place.place_name}</div><div class="text-xs text-gray-400 truncate">${place.road_address_name || place.address_name}</div>`;
            item.onmousedown = (e) => {
                e.preventDefault();
                isSelectingAutocomplete = true;
                input.value = place.place_name;
                box.classList.add("hidden");
                setTimeout(() => {
                    isSelectingAutocomplete = false;
                    input.blur();
                }, 0);
            };
            box.appendChild(item);
        });
    });
}

// =========================
// 경로 탐색 및 그리기
// =========================
function requestRoute() {
    const start = document.getElementById("start").value.trim();
    const end = document.getElementById("end").value.trim();
    if (!start || !end) {
        alert("출발지와 목적지를 모두 입력해주세요.");
        return;
    }

    const btn = document.querySelector("button[onclick='requestRoute()']");
    if (btn) {
        btn.innerText = "🚗 경로 탐색 중...";
        btn.disabled = true;
    }

    fetch("/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end }),
    })
        .then((res) => res.json())
        .then((data) => {
            if (btn) {
                btn.innerText = "🔍 맛집 로드 검색하기";
                btn.disabled = false;
            }
            document.getElementById("empty-state")?.classList.add("hidden");
            document.getElementById("result-area")?.classList.remove("hidden");
            
            // 지도 크기가 변했을 수 있으므로 relayout 호출
            setTimeout(() => map.relayout(), 100);
            drawRoute(data);
        })
        .catch((err) => {
            if (btn) {
                btn.innerText = "🔍 맛집 로드 검색하기";
                btn.disabled = false;
            }
            alert("오류: " + err.message);
        });
}

function drawRoute(data) {
    if (!data.route) return;
    const path = data.route.map((p) => new kakao.maps.LatLng(p[1], p[0]));
    if (polyline) polyline.setMap(null);
    polyline = new kakao.maps.Polyline({
        path,
        strokeWeight: 6,
        strokeColor: "#2563EB",
        strokeOpacity: 0.8
    });
    polyline.setMap(map);

    const bounds = new kakao.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.setBounds(bounds);

    const totalMeters = calculateTotalDistance(path);
    const routeMeta = document.getElementById("route-meta");
    if (routeMeta) {
        routeMeta.classList.remove("hidden");
        document.getElementById("meta-distance").textContent = `${(totalMeters / 1000).toFixed(1)} km`;
        document.getElementById("meta-time").textContent = estimateTime(totalMeters);
    }

    lastRests = data.rests || [];
    drawRestAreas(lastRests);
}

// =========================
// 휴게소 마커 및 목록 그리기
// =========================
function drawRestAreas(rests) {
    const list = document.getElementById("rest-list");
    if (!list) return;
    list.innerHTML = "";
    markers.forEach((m) => m.setMap(null));
    markers = [];

    if (!polyline) return;
    const path = polyline.getPath();
    const travelDirection = getTravelDirection(path);
    const startPoint = path[0];

    const startName = document.getElementById("start").value.trim();
    const endName = document.getElementById("end").value.trim();

    let filtered = rests.filter((r) => isRestAreaNearRoute(r.lat, r.lng, path) && r.direction === travelDirection);
    
    filtered.sort((a, b) => getDistance(startPoint.getLat(), startPoint.getLng(), a.lat, a.lng) - getDistance(startPoint.getLat(), startPoint.getLng(), b.lat, b.lng));

    // START 카드
    const startItem = document.createElement("div");
    startItem.className = "timeline-item animate-fade-in-up";
    startItem.innerHTML = `<div class="timeline-dot bg-blue-400"></div><div class="timeline-card-wrapper flex"><div class="bg-red-300/20 p-3 px-4 rounded-xl flex items-center gap-3"><span class="text-[9px] font-bold text-red-400 bg-white px-1.5 py-0.5 rounded border">START</span><h3 class="text-sm font-bold text-gray-900">${startName}</h3></div></div>`;
    list.appendChild(startItem);

    filtered.forEach((r, idx) => {
        const loc = new kakao.maps.LatLng(r.lat, r.lng);
        const marker = new kakao.maps.Marker({ position: loc, map: map });
        markers.push(marker);
        kakao.maps.event.addListener(marker, "click", () => openSimpleInfo(marker, r));

        const item = document.createElement("div");
        item.className = "timeline-item animate-fade-in-up";
        item.style.animationDelay = `${(idx + 1) * 0.1}s`;
        item.innerHTML = `
          <div class="timeline-dot"></div>
          <div class="timeline-card-wrapper">
            <div class="relative bg-white p-5 pr-16 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="handleCardClick(${r.id})">
              <h3 class="font-black text-lg text-gray-800 mb-1">${formatRestName(r.name)}</h3>
              <div class="flex items-center mb-2"><span class="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">${r.highway_name || "고속도로"}</span></div>
              <div class="flex items-center gap-1.5"><div class="flex items-center gap-1 bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded text-[10px] font-black uppercase"><i data-lucide="award" class="w-3 h-3"></i><span>Best</span></div><span class="text-xs font-bold text-gray-600 truncate max-w-[140px]">${r.food || "대표 메뉴 정보"}</span></div>
            </div>
          </div>`;
        if (!window.restData) window.restData = {};
        window.restData[r.id] = r;
        list.appendChild(item);
    });

    // END 카드
    const endItem = document.createElement("div");
    endItem.className = "timeline-item animate-fade-in-up";
    endItem.innerHTML = `<div class="timeline-dot bg-blue-300"></div><div class="timeline-card-wrapper flex"><div class="bg-blue-300/20 p-3 px-4 rounded-xl flex items-center gap-3"><span class="text-[9px] font-bold text-gray-900 bg-white px-1.5 py-0.5 rounded border">END</span><h3 class="text-sm font-bold text-gray-900">${endName}</h3></div></div>`;
    list.appendChild(endItem);

    if (window.lucide) lucide.createIcons();
}

// =========================
// 상세 모달 및 유틸리티
// =========================
window.handleCardClick = function (restId) {
    const r = window.restData?.[restId];
    if (r) openRestModal(r);
};

function openRestModal(rest) {
    const restName = formatRestName(rest.name);
    document.getElementById("modal-name").textContent = restName;
    const addrEl = document.getElementById("modal-address");
    
    if (addressCache[rest.id]) addrEl.textContent = addressCache[rest.id];
    else getAddressFromCoords(rest.lat, rest.lng, (addr) => { 
        addressCache[rest.id] = addr; 
        addrEl.textContent = addr; 
    });

    document.getElementById("modal-menu-name").textContent = rest.food || "정보 없음";
    
    // 시설물 정보 업데이트 (함수는 기존 기능 유지)
    setFac("fac-gas", rest.gas);
    setFac("fac-ev", rest.elec);
    setFac("fac-pharmacy", rest.pharmacy);
    setFac("fac-baby", rest.nurse);

    const kakaoBtn = document.getElementById("modal-kakao");
    if (kakaoBtn) {
        kakaoBtn.onclick = () => {
            const url = `https://map.kakao.com/link/map/${restName},${rest.lat},${rest.lng}`;
            window.open(url, '_blank');
        };
    }

    const descEl = document.getElementById("modal-menu-desc");
    descEl.textContent = "정보를 불러오는 중...";
    fetch("/get_info", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ name: rest.name }) 
    })
    .then(res => res.json()).then(data => { 
        descEl.innerHTML = data.info ? data.info.replace(/\n/g, "<br>") : "이 휴게소의 인기 메뉴 정보를 제공합니다."; 
    })
    .catch(() => descEl.textContent = "정보를 불러오지 못했습니다.");

    document.getElementById("rest-modal")?.classList.remove("hidden");
}

function getAddressFromCoords(lat, lng, callback) {
    if (!geocoder) return;
    geocoder.coord2Address(lng, lat, (result, status) => {
        if (status === kakao.maps.services.Status.OK) {
            callback(result[0].road_address?.address_name || result[0].address?.address_name || "주소 미상");
        }
    });
}

// 기타 헬퍼 함수들은 이전과 동일 (getDistance, formatRestName 등)
function formatRestName(name) { return name.endsWith("휴게소") ? name : `${name}휴게소`; }
function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calculateTotalDistance(path) {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        total += getDistance(path[i].getLat(), path[i].getLng(), path[i + 1].getLat(), path[i + 1].getLng());
    }
    return total;
}
function estimateTime(totalMeters) {
    const minutes = Math.round((totalMeters / 1000) / 90 * 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h === 0 ? `${m}분` : `${h}시간 ${m}분`;
}
function isRestAreaNearRoute(restLat, restLng, routePoints) {
    for (let i = 0; i < routePoints.length - 1; i += 5) {
        if (getDistance(restLat, restLng, routePoints[i].getLat(), routePoints[i].getLng()) <= 1500) return true;
    }
    return false;
}
function getTravelDirection(path) {
    const start = path[0];
    const end = path[path.length - 1];
    return end.getLat() < start.getLat() ? "하행" : "상행";
}
function openSimpleInfo(marker, rest) {
    if (infowindow) infowindow.close();
    infowindow = new kakao.maps.InfoWindow({ 
        content: `<div class="p-2 text-xs font-bold">${formatRestName(rest.name)}</div>`, 
        removable: true 
    });
    infowindow.open(map, marker);
}
function setFac(id, has) {
    const el = document.getElementById(id);
    if (!el) return;
    if (has === "Y") {
        el.className = "flex flex-col items-center justify-center min-h-[90px] py-4 rounded-2xl border border-blue-100 bg-blue-50 text-blue-600 shadow-sm";
        el.style.opacity = "1";
    } else {
        el.className = "flex flex-col items-center justify-center min-h-[90px] py-4 rounded-2xl border border-gray-100 bg-gray-50/50 text-gray-300";
        el.style.opacity = "0.3"; 
    }
}
window.closeRestModal = () => document.getElementById("rest-modal").classList.add("hidden");
