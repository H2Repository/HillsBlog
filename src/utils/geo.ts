import { GeoLocation } from '../types';

export interface GpsResult {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export function getCurrentGpsPosition(): Promise<GpsResult> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('이 브라우저에서는 위치 서비스를 지원하지 않습니다.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
          timestamp: position.timestamp,
        });
      },
      (error) => {
        let msg = '위치 정보를 가져올 수 없습니다.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = '위치 정보 접근 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = '현재 위치 정보를 사용할 수 없습니다.';
            break;
          case error.TIMEOUT:
            msg = '위치 정보 요청 시간이 초과되었습니다.';
            break;
        }
        reject(new Error(msg));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<{ address: string; region: string; landmark?: string }> {
  try {
    // Request OpenStreetMap Nominatim without language forcing so it returns authentic native local language
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Reverse geocode failed with status ${res.status}`);
    }

    const data = await res.json();
    const addr = data.address || {};
    
    // Construct address in authentic local language
    const country = addr.country || '';
    const state = addr.state || addr.province || '';
    const city = addr.city || addr.town || addr.borough || addr.county || '';
    const suburb = addr.suburb || addr.quarter || addr.neighbourhood || addr.village || addr.city_district || '';
    const road = addr.road || addr.street || '';
    const houseNumber = addr.house_number || '';
    const landmark = data.name || addr.amenity || addr.tourism || addr.historic || addr.shop || undefined;

    // Detailed address (native local language)
    const addressParts = [road, houseNumber, suburb, city, state, country].filter(Boolean);
    const fullAddress = data.display_name || addressParts.join(', ');

    // Concise region name in local language (e.g., "Thành phố Hà Nội", "Tỉnh Thanh Hóa, Sầm Sơn", "경기도 수원시")
    let shortRegion = '';
    if (city && suburb) {
      shortRegion = `${city}, ${suburb}`;
    } else if (state && city) {
      shortRegion = `${state}, ${city}`;
    } else if (city) {
      shortRegion = city;
    } else if (state) {
      shortRegion = state;
    } else if (suburb) {
      shortRegion = suburb;
    } else {
      shortRegion = fullAddress.split(',')[0]?.trim() || '여행지';
    }

    return {
      address: fullAddress,
      region: shortRegion,
      landmark: landmark || undefined,
    };
  } catch (err) {
    console.warn('Reverse geocoding error:', err);
    return {
      address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      region: `Location (${lat.toFixed(2)}, ${lng.toFixed(2)})`,
    };
  }
}

// Calculate Haversine distance in km
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export const POPULAR_BIKE_DESTINATIONS: GeoLocation[] = [
  {
    lat: 21.0285,
    lng: 105.8542,
    address: 'Phố Đinh Tiên Hoàng, Phường Hoàn Kiếm, Thành phố Hà Nội, Việt Nam',
    region: 'Quận Hoàn Kiếm, Hà Nội',
    landmark: 'Hồ Hoàn Kiếm (Hồ Gươm)',
  },
  {
    lat: 19.7341,
    lng: 105.9010,
    address: 'Đường Hồ Xuân Hương, Phường Trung Sơn, TP. Sầm Sơn, Tỉnh Thanh Hóa, Việt Nam',
    region: 'TP. Sầm Sơn, Thanh Hóa',
    landmark: 'Bãi biển Sầm Sơn',
  },
  {
    lat: 34.1205,
    lng: 133.0076,
    address: '日本愛媛県今治市 来島海峡大橋 サイクリングロード',
    region: '愛媛県 今治市 (しまなみ海道)',
    landmark: '来島海峡大橋 (Kurushima Kaikyo Bridge)',
  },
  {
    lat: 23.8517,
    lng: 120.9154,
    address: '台灣南投縣魚池鄉中山路599號',
    region: '南投縣 魚池鄉 (日月潭)',
    landmark: '向山自行車道 (Xiangshan Bike Trail)',
  },
  {
    lat: 52.3276,
    lng: 4.8872,
    address: 'De Borcht 10, 1083 AC Amsterdam, Nederland',
    region: 'Amsterdam, Noord-Holland',
    landmark: 'Riekermolen fietspad',
  },
  {
    lat: 48.2294,
    lng: 15.3323,
    address: 'Donauradweg Wachau, 3390 Melk, Österreich',
    region: 'Melk, Niederösterreich',
    landmark: 'Stift Melk Donauufer',
  },
];

export const POPULAR_SOLO_DESTINATIONS = POPULAR_BIKE_DESTINATIONS;
