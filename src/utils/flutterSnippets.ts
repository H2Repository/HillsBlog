// Flutter Source Code Snippets synchronized with the current web app

export const FLUTTER_CODE_SNIPPETS = {
  pubspec: `# pubspec.yaml
name: hills_blog_app
description: "Hill's Blog - 실시간 위치와 사진을 연동하여 여행 기록과 지역 정보를 남기는 Flutter 앱"
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  provider: ^6.1.2
  intl: ^0.19.0
  uuid: ^4.4.0
  
  # 실시간 위치 (GPS) & 주소 역지오코딩
  geolocator: ^11.0.0
  geocoding: ^3.0.0
  
  # 사진 촬영 및 갤러리 이미지 선택
  image_picker: ^1.1.0
  
  # 히스토리 지도 (OpenStreetMap 기반)
  flutter_map: ^6.1.0
  latlong2: ^0.9.1

  # Firebase 클라우드 동기화
  firebase_core: ^2.32.0
  cloud_firestore: ^4.17.5

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

flutter:
  uses-material-design: true
`,

  main: `// lib/main.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'models/diary_entry.dart';
import 'screens/diary_editor_screen.dart';
import 'screens/travel_map_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Firebase 초기화가 필요한 경우 아래 주석을 해제하세요.
  // try {
  //   await Firebase.initializeApp();
  // } catch (e) {
  //   debugPrint('Firebase not configured, running in local mode: $e');
  // }

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => DiaryProvider()),
      ],
      child: const HillsBlogApp(),
    ),
  );
}

class HillsBlogApp extends StatelessWidget {
  const HillsBlogApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "Hill's Blog",
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFD97706), // Amber primary
          brightness: Brightness.light,
          surface: Colors.white,
        ),
        scaffoldBackgroundColor: const Color(0xFFFAF9F6),
        useMaterial3: true,
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1C1917), // Stone-900
          foregroundColor: Colors.white,
          elevation: 0,
          centerTitle: false,
        ),
      ),
      home: const MainHomeScreen(),
    );
  }
}

class MainHomeScreen extends StatefulWidget {
  const MainHomeScreen({super.key});

  @override
  State<MainHomeScreen> createState() => _MainHomeScreenState();
}

class _MainHomeScreenState extends State<MainHomeScreen> {
  int _currentIndex = 0;
  String _searchQuery = '';
  String _selectedRegion = '전체';

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<DiaryProvider>();
    final allDiaries = provider.diaries;

    // Filter by search query and region
    final filteredDiaries = allDiaries.where((d) {
      final matchesSearch = _searchQuery.isEmpty ||
          d.title.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          d.content.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          d.location.region.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          d.moodTags.any((tag) => tag.toLowerCase().contains(_searchQuery.toLowerCase()));

      final matchesRegion = _selectedRegion == '전체' || d.location.region == _selectedRegion;

      return matchesSearch && matchesRegion;
    }).toList();

    // Unique regions for filter chips
    final regions = ['전체', ...{for (var d in allDiaries) d.location.region}];

    final pages = [
      // 1. 블로그 피드 탭
      Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: const Color(0xFFD97706),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.explore, size: 20, color: Colors.white),
              ),
              const SizedBox(width: 10),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text("Hill's Blog", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  Text("실시간 위치 & 사진 여행 기록", style: TextStyle(fontSize: 11, color: Colors.white70)),
                ],
              ),
            ],
          ),
        ),
        body: Column(
          children: [
            // Search & Filter Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              color: Colors.white,
              child: Column(
                children: [
                  // Search Bar
                  TextField(
                    onChanged: (val) => setState(() => _searchQuery = val),
                    decoration: InputDecoration(
                      hintText: '코스, 일기 제목, 태그 검색...',
                      hintStyle: TextStyle(fontSize: 13, color: Colors.grey.shade400),
                      prefixIcon: const Icon(Icons.search, size: 20),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 8),
                      filled: true,
                      fillColor: const Color(0xFFF5F5F4),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey.shade300),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey.shade200),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  // Region Filter Chips
                  SizedBox(
                    height: 32,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: regions.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 6),
                      itemBuilder: (context, idx) {
                        final reg = regions[idx];
                        final isSelected = _selectedRegion == reg;
                        return ChoiceChip(
                          label: Text(reg, style: TextStyle(fontSize: 11, color: isSelected ? Colors.white : Colors.stone)),
                          selected: isSelected,
                          selectedColor: const Color(0xFF1C1917),
                          backgroundColor: const Color(0xFFF5F5F4),
                          onSelected: (_) => setState(() => _selectedRegion = reg),
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: Color(0xFFE7E5E4)),

            // Feed List
            Expanded(
              child: filteredDiaries.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.menu_book, size: 48, color: Colors.grey.shade300),
                          const SizedBox(height: 12),
                          const Text('등록된 여행 일기가 없습니다.', style: TextStyle(color: Colors.grey, fontSize: 14)),
                          const SizedBox(height: 4),
                          const Text('아래 버튼을 눌러 첫 번째 여행을 기록해보세요!', style: TextStyle(color: Colors.grey, fontSize: 12)),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(14),
                      itemCount: filteredDiaries.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, idx) {
                        final item = filteredDiaries[idx];
                        return _DiaryFeedCard(
                          entry: item,
                          onTap: () {
                            showModalBottomSheet(
                              context: context,
                              isScrollControlled: true,
                              shape: const RoundedRectangleBorder(
                                borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                              ),
                              builder: (_) => _DiaryDetailSheet(entry: item),
                            );
                          },
                          onEdit: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => DiaryEditorScreen(initialEntry: item),
                              ),
                            );
                          },
                          onDelete: () {
                            showDialog(
                              context: context,
                              builder: (ctx) => AlertDialog(
                                title: const Text('일기 삭제'),
                                content: Text('"\${item.title}" 일기를 정말 삭제하시겠습니까?'),
                                actions: [
                                  TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
                                  TextButton(
                                    onPressed: () {
                                      provider.removeDiary(item.id);
                                      Navigator.pop(ctx);
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        const SnackBar(content: Text('일기가 삭제되었습니다.')),
                                      );
                                    },
                                    child: const Text('삭제', style: TextStyle(color: Colors.red)),
                                  ),
                                ],
                              ),
                            );
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),

      // 2. 히스토리 지도 탭 (User Requested: '히스토리 지도')
      const TravelMapScreen(),
    ];

    return Scaffold(
      body: pages[_currentIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
        backgroundColor: Colors.white,
        indicatorColor: const Color(0xFFFEF3C7), // Amber 100
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.book_outlined),
            selectedIcon: Icon(Icons.book, color: Color(0xFFD97706)),
            label: '블로그 피드',
          ),
          NavigationDestination(
            icon: Icon(Icons.map_outlined),
            selectedIcon: Icon(Icons.map, color: Color(0xFFD97706)),
            label: '히스토리 지도',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const DiaryEditorScreen()),
          );
        },
        backgroundColor: const Color(0xFFD97706),
        foregroundColor: Colors.white,
        icon: const Icon(Icons.edit),
        label: const Text('새 일기 쓰기', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
    );
  }
}

class _DiaryFeedCard extends StatelessWidget {
  final DiaryEntry entry;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _DiaryFeedCard({
    required this.entry,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE7E5E4)),
      ),
      color: Colors.white,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: Region & Date/Time & Options
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFFBEB),
                      borderRadius: BorderRadius.circular(6),
                      border: BorderSide(color: const Color(0xFFFDE68A)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.location_on, size: 12, color: Color(0xFFD97706)),
                        const SizedBox(width: 3),
                        Text(
                          entry.location.region,
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF92400E)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '\${entry.date} \${entry.time}',
                    style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                  ),
                  const Spacer(),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 18, color: Colors.grey),
                    padding: EdgeInsets.zero,
                    onSelected: (val) {
                      if (val == 'edit') onEdit();
                      if (val == 'delete') onDelete();
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(value: 'edit', child: Row(children: [Icon(Icons.edit, size: 16), SizedBox(width: 8), Text('수정')])),
                      const PopupMenuItem(value: 'delete', child: Row(children: [Icon(Icons.delete, size: 16, color: Colors.red), SizedBox(width: 8), Text('삭제', style: TextStyle(color: Colors.red))])),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Title
              Text(
                entry.title,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1C1917)),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),

              // Content snippet
              Text(
                entry.content,
                style: TextStyle(fontSize: 13, color: Colors.grey.shade700, height: 1.4),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 10),

              // Footer: Rating & Tags & Weather
              Row(
                children: [
                  // Rating stars
                  Row(
                    children: List.generate(5, (index) {
                      return Icon(
                        index < entry.rating ? Icons.star : Icons.star_border,
                        size: 14,
                        color: Colors.amber.shade700,
                      );
                    }),
                  ),
                  const SizedBox(width: 10),
                  // Weather
                  Text(
                    _weatherIcon(entry.weather),
                    style: const TextStyle(fontSize: 13),
                  ),
                  const SizedBox(width: 8),
                  // Tags
                  Expanded(
                    child: Text(
                      entry.moodTags.join(' '),
                      style: const TextStyle(fontSize: 11, color: Color(0xFFD97706)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (entry.photos.isNotEmpty)
                    Row(
                      children: [
                        const Icon(Icons.photo_library, size: 14, color: Colors.grey),
                        const SizedBox(width: 3),
                        Text('\${entry.photos.length}', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                      ],
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _weatherIcon(String weather) {
    switch (weather) {
      case 'sunny': return '☀️';
      case 'cloudy': return '☁️';
      case 'rainy': return '🌧️';
      case 'snowy': return '❄️';
      case 'windy': return '💨';
      default: return '☀️';
    }
  }
}

class _DiaryDetailSheet extends StatelessWidget {
  final DiaryEntry entry;

  const _DiaryDetailSheet({required this.entry});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
      child: ListView(
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  entry.location.region,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF92400E)),
                ),
              ),
              const Spacer(),
              Text('\${entry.date} \${entry.time}', style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 12),
          Text(entry.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.place, size: 16, color: Color(0xFFD97706)),
              const SizedBox(width: 4),
              Expanded(
                child: Text(entry.location.address, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
              ),
            ],
          ),
          const Divider(height: 24),
          Text(
            entry.content,
            style: const TextStyle(fontSize: 15, height: 1.6, color: Color(0xFF292524)),
          ),
          const SizedBox(height: 16),
          // Local Insights
          if (entry.localInsights.recommendedForSolo.isNotEmpty || entry.localInsights.localFood != null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFBEB),
                borderRadius: BorderRadius.circular(12),
                border: BorderSide(color: const Color(0xFFFDE68A)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.lightbulb_outline, size: 16, color: Color(0xFFD97706)),
                      SizedBox(width: 6),
                      Text('여행 로컬 인사이트', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF92400E))),
                    ],
                  ),
                  if (entry.localInsights.recommendedForSolo.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text('💡 추천 이유: \${entry.localInsights.recommendedForSolo}', style: const TextStyle(fontSize: 13)),
                  ],
                  if (entry.localInsights.localFood != null && entry.localInsights.localFood!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text('🍽️ 로컬 맛집/보급: \${entry.localInsights.localFood}', style: const TextStyle(fontSize: 13)),
                  ],
                  if (entry.localInsights.soloTravelTip != null && entry.localInsights.soloTravelTip!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text('📌 여행 팁: \${entry.localInsights.soloTravelTip}', style: const TextStyle(fontSize: 13)),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}
`,

  models: `// lib/models/diary_entry.dart
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

class GeoLocation {
  final double lat;
  final double lng;
  final double? accuracy;
  final String address;
  final String region;
  final String? landmark;
  final bool isRealtimeGps;

  GeoLocation({
    required this.lat,
    required this.lng,
    this.accuracy,
    required this.address,
    required this.region,
    this.landmark,
    this.isRealtimeGps = false,
  });

  Map<String, dynamic> toMap() {
    return {
      'lat': lat,
      'lng': lng,
      if (accuracy != null) 'accuracy': accuracy,
      'address': address,
      'region': region,
      if (landmark != null) 'landmark': landmark,
      'isRealtimeGps': isRealtimeGps,
    };
  }

  factory GeoLocation.fromMap(Map<String, dynamic> map) {
    return GeoLocation(
      lat: (map['lat'] as num?)?.toDouble() ?? 37.5665,
      lng: (map['lng'] as num?)?.toDouble() ?? 126.9780,
      accuracy: (map['accuracy'] as num?)?.toDouble(),
      address: map['address'] as String? ?? '위치 정보 없음',
      region: map['region'] as String? ?? '여행 현장',
      landmark: map['landmark'] as String?,
      isRealtimeGps: map['isRealtimeGps'] as bool? ?? false,
    );
  }
}

class TravelPhoto {
  final String id;
  final String url;
  final String? caption;
  final String timestamp;
  final bool isCover;

  TravelPhoto({
    required this.id,
    required this.url,
    this.caption,
    required this.timestamp,
    this.isCover = false,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'url': url,
      if (caption != null) 'caption': caption,
      'timestamp': timestamp,
      'isCover': isCover,
    };
  }

  factory TravelPhoto.fromMap(Map<String, dynamic> map) {
    return TravelPhoto(
      id: map['id'] as String? ?? const Uuid().v4(),
      url: map['url'] as String? ?? '',
      caption: map['caption'] as String?,
      timestamp: map['timestamp'] as String? ?? '',
      isCover: map['isCover'] as bool? ?? false,
    );
  }
}

class LocalInsights {
  final String recommendedForSolo;
  final String? localFood;
  final String? transportTip;
  final String? soloTravelTip;

  LocalInsights({
    required this.recommendedForSolo,
    this.localFood,
    this.transportTip,
    this.soloTravelTip,
  });

  Map<String, dynamic> toMap() {
    return {
      'recommendedForSolo': recommendedForSolo,
      if (localFood != null) 'localFood': localFood,
      if (transportTip != null) 'transportTip': transportTip,
      if (soloTravelTip != null) 'soloTravelTip': soloTravelTip,
    };
  }

  factory LocalInsights.fromMap(Map<String, dynamic> map) {
    return LocalInsights(
      recommendedForSolo: map['recommendedForSolo'] as String? ?? '',
      localFood: map['localFood'] as String?,
      transportTip: map['transportTip'] as String?,
      soloTravelTip: map['soloTravelTip'] as String?,
    );
  }
}

class DiaryEntry {
  final String id;
  final String title;
  final String content;
  final String date; // YYYY-MM-DD
  final String time; // HH:mm
  final GeoLocation location;
  final List<TravelPhoto> photos;
  final String weather;
  final List<String> moodTags;
  final LocalInsights localInsights;
  final int rating;
  final int createdAt;
  final int updatedAt;

  DiaryEntry({
    required this.id,
    required this.title,
    required this.content,
    required this.date,
    required this.time,
    required this.location,
    required this.photos,
    required this.weather,
    required this.moodTags,
    required this.localInsights,
    this.rating = 5,
    required this.createdAt,
    required this.updatedAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'content': content,
      'date': date,
      'time': time,
      'location': location.toMap(),
      'photos': photos.map((p) => p.toMap()).toList(),
      'weather': weather,
      'moodTags': moodTags,
      'localInsights': localInsights.toMap(),
      'rating': rating,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  factory DiaryEntry.fromMap(Map<String, dynamic> map) {
    return DiaryEntry(
      id: map['id'] as String? ?? const Uuid().v4(),
      title: map['title'] as String? ?? '',
      content: map['content'] as String? ?? '',
      date: map['date'] as String? ?? DateTime.now().toString().substring(0, 10),
      time: map['time'] as String? ?? '12:00',
      location: GeoLocation.fromMap(map['location'] as Map<String, dynamic>? ?? {}),
      photos: (map['photos'] as List<dynamic>?)
              ?.map((p) => TravelPhoto.fromMap(p as Map<String, dynamic>))
              .toList() ??
          [],
      weather: map['weather'] as String? ?? 'sunny',
      moodTags: (map['moodTags'] as List<dynamic>?)?.map((t) => t.toString()).toList() ?? [],
      localInsights: LocalInsights.fromMap(map['localInsights'] as Map<String, dynamic>? ?? {}),
      rating: (map['rating'] as num?)?.toInt() ?? 5,
      createdAt: (map['createdAt'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
      updatedAt: (map['updatedAt'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
    );
  }
}

class DiaryProvider with ChangeNotifier {
  final List<DiaryEntry> _diaries = [];

  List<DiaryEntry> get diaries => List.unmodifiable(_diaries);

  DiaryProvider() {
    // 기본 샘플 데이터 초기화
    _initSampleData();
  }

  void _initSampleData() {
    final now = DateTime.now();
    _diaries.addAll([
      DiaryEntry(
        id: 'sample-1',
        title: '세토내해 푸른 바다를 건너는 다리와 섬의 질주',
        content: '자전거 여행자들의 성지 시마나미 해도. 6개 섬을 가로지르는 70km 코스 라이딩!',
        date: '\${now.year}-\${now.month.toString().padLeft(2, '0')}-\${now.day.toString().padLeft(2, '0')}',
        time: '10:30',
        location: GeoLocation(
          lat: 34.1205,
          lng: 133.0076,
          address: 'Japan, Ehime, Imabari, Kurushima Kaikyo Bridge',
          region: '에히메 시마나미 해도',
          landmark: '쿠루시마 해협 대교',
          isRealtimeGps: true,
        ),
        photos: [],
        weather: 'sunny',
        moodTags: ['#자전거여행', '#시마나미해도', '#오전라이딩'],
        localInsights: LocalInsights(
          recommendedForSolo: '모든 교량 진입로가 완만한 경사로로 설계되어 초보자도 1인 라이딩 가능',
          localFood: '세토우치 레몬 라멘, 귤 젤라또',
          transportTip: 'JR 오노미치역 또는 이마바리역에서 로드바이크 대여 가능',
          soloTravelTip: '파란색 유도선(Blue Line)만 따라가면 길 잃을 염려가 없습니다.',
        ),
        rating: 5,
        createdAt: now.millisecondsSinceEpoch,
        updatedAt: now.millisecondsSinceEpoch,
      ),
    ]);
  }

  void addDiary(DiaryEntry entry) {
    _diaries.insert(0, entry);
    notifyListeners();
  }

  void updateDiary(DiaryEntry updated) {
    final index = _diaries.indexWhere((item) => item.id == updated.id);
    if (index != -1) {
      _diaries[index] = updated;
      notifyListeners();
    }
  }

  void removeDiary(String id) {
    _diaries.removeWhere((item) => item.id == id);
    notifyListeners();
  }
}
`,

  screens: `// lib/screens/travel_map_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import '../models/diary_entry.dart';

class TravelMapScreen extends StatelessWidget {
  const TravelMapScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final diaries = context.watch<DiaryProvider>().diaries;
    final points = diaries.map((d) => LatLng(d.location.lat, d.location.lng)).toList();
    final center = points.isNotEmpty ? points.first : const LatLng(34.1205, 133.0076);

    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.timeline, size: 20, color: Color(0xFFFBBF24)),
            SizedBox(width: 8),
            Text('히스토리 지도', style: TextStyle(fontWeight: FontWeight.bold)),
          ],
        ),
      ),
      body: FlutterMap(
        options: MapOptions(
          initialCenter: center,
          initialZoom: 7.0,
        ),
        children: [
          TileLayer(
            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            userAgentPackageName: 'com.example.hills_blog_app',
          ),
          if (points.length > 1)
            PolylineLayer(
              polylines: [
                Polyline(
                  points: points,
                  color: const Color(0xFFD97706),
                  strokeWidth: 4.0,
                ),
              ],
            ),
          MarkerLayer(
            markers: diaries.map((diary) {
              return Marker(
                point: LatLng(diary.location.lat, diary.location.lng),
                width: 44,
                height: 44,
                child: GestureDetector(
                  onTap: () {
                    showModalBottomSheet(
                      context: context,
                      builder: (_) => Container(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFEF3C7),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    diary.location.region,
                                    style: const TextStyle(
                                      color: Color(0xFF92400E),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 11,
                                    ),
                                  ),
                                ),
                                const Spacer(),
                                Text('\${diary.date} \${diary.time}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(diary.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 6),
                            Text(diary.content, maxLines: 2, overflow: TextOverflow.ellipsis),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                Row(
                                  children: List.generate(5, (i) => Icon(
                                    i < diary.rating ? Icons.star : Icons.star_border,
                                    size: 14,
                                    color: Colors.amber,
                                  )),
                                ),
                                const Spacer(),
                                Text(diary.location.address, style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                  child: const Icon(Icons.location_pin, color: Color(0xFFDC2626), size: 40),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
`,

  editor: `// lib/screens/diary_editor_screen.dart
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';
import '../models/diary_entry.dart';
import '../services/location_service.dart';

class DiaryEditorScreen extends StatefulWidget {
  final DiaryEntry? initialEntry;

  const DiaryEditorScreen({super.key, this.initialEntry});

  @override
  State<DiaryEditorScreen> createState() => _DiaryEditorScreenState();
}

class _DiaryEditorScreenState extends State<DiaryEditorScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  final _regionController = TextEditingController();
  final _addressController = TextEditingController();
  final _landmarkController = TextEditingController();
  final _recommendController = TextEditingController();
  final _foodController = TextEditingController();
  final _tipController = TextEditingController();

  double _lat = 37.5665;
  double _lng = 126.9780;
  bool _isLoadingGps = false;
  int _rating = 5;
  String _selectedWeather = 'sunny';
  List<String> _tags = ['#여행', '#힐링'];
  final List<TravelPhoto> _photos = [];

  final ImagePicker _picker = ImagePicker();

  final List<Map<String, String>> _weatherOptions = [
    {'code': 'sunny', 'label': '맑음', 'icon': '☀️'},
    {'code': 'cloudy', 'label': '흐림', 'icon': '☁️'},
    {'code': 'rainy', 'label': '비', 'icon': '🌧️'},
    {'code': 'snowy', 'label': '눈', 'icon': '❄️'},
    {'code': 'windy', 'label': '바람', 'icon': '💨'},
  ];

  @override
  void initState() {
    super.initState();
    if (widget.initialEntry != null) {
      final entry = widget.initialEntry!;
      _titleController.text = entry.title;
      _contentController.text = entry.content;
      _regionController.text = entry.location.region;
      _addressController.text = entry.location.address;
      _landmarkController.text = entry.location.landmark ?? '';
      _recommendController.text = entry.localInsights.recommendedForSolo;
      _foodController.text = entry.localInsights.localFood ?? '';
      _tipController.text = entry.localInsights.soloTravelTip ?? '';
      _lat = entry.location.lat;
      _lng = entry.location.lng;
      _rating = entry.rating;
      _selectedWeather = entry.weather;
      _tags = List.from(entry.moodTags);
      _photos.addAll(entry.photos);
    }
  }

  Future<void> _fetchCurrentGps() async {
    setState(() => _isLoadingGps = true);
    try {
      final loc = await LocationService.determineCurrentLocation();
      setState(() {
        _lat = loc.lat;
        _lng = loc.lng;
        _regionController.text = loc.region;
        _addressController.text = loc.address;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('현재 GPS 위치가 성공적으로 연동되었습니다.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('GPS 오류: \${e.toString()}')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoadingGps = false);
      }
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final pickedFile = await _picker.pickImage(
        source: source,
        maxWidth: 720,
        maxHeight: 720,
        imageQuality: 82,
      );
      if (pickedFile != null) {
        setState(() {
          _photos.add(
            TravelPhoto(
              id: const Uuid().v4(),
              url: pickedFile.path,
              timestamp: DateTime.now().toIso8601String(),
              isCover: _photos.isEmpty,
            ),
          );
        });
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('사진 불러오기 실패: $e')),
      );
    }
  }

  void _resetForm() {
    setState(() {
      _titleController.clear();
      _contentController.clear();
      _regionController.clear();
      _addressController.clear();
      _landmarkController.clear();
      _recommendController.clear();
      _foodController.clear();
      _tipController.clear();
      _rating = 5;
      _photos.clear();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('작성 내용이 초기화되었습니다.')),
    );
  }

  void _saveDiary() {
    if (!_formKey.currentState!.validate()) return;

    final now = DateTime.now();
    final dateStr = '\${now.year}-\${now.month.toString().padLeft(2, '0')}-\${now.day.toString().padLeft(2, '0')}';
    final timeStr = '\${now.hour.toString().padLeft(2, '0')}:\${now.minute.toString().padLeft(2, '0')}';

    final entry = DiaryEntry(
      id: widget.initialEntry?.id ?? const Uuid().v4(),
      title: _titleController.text.trim(),
      content: _contentController.text.trim(),
      date: widget.initialEntry?.date ?? dateStr,
      time: widget.initialEntry?.time ?? timeStr,
      location: GeoLocation(
        lat: _lat,
        lng: _lng,
        address: _addressController.text.trim().isEmpty ? '여행 위치' : _addressController.text.trim(),
        region: _regionController.text.trim().isEmpty ? '여행지' : _regionController.text.trim(),
        landmark: _landmarkController.text.trim().isEmpty ? null : _landmarkController.text.trim(),
        isRealtimeGps: true,
      ),
      photos: List.from(_photos),
      weather: _selectedWeather,
      moodTags: _tags,
      localInsights: LocalInsights(
        recommendedForSolo: _recommendController.text.trim(),
        localFood: _foodController.text.trim().isEmpty ? null : _foodController.text.trim(),
        soloTravelTip: _tipController.text.trim().isEmpty ? null : _tipController.text.trim(),
      ),
      rating: _rating,
      createdAt: widget.initialEntry?.createdAt ?? now.millisecondsSinceEpoch,
      updatedAt: now.millisecondsSinceEpoch,
    );

    final provider = context.read<DiaryProvider>();
    if (widget.initialEntry != null) {
      provider.updateDiary(entry);
    } else {
      provider.addDiary(entry);
    }

    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(widget.initialEntry != null ? '일기가 수정되었습니다.' : '일기가 등록되었습니다.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.initialEntry != null ? '일기 수정' : '여행 일기 작성', style: const TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: '초기화',
            onPressed: _resetForm,
          ),
          IconButton(
            icon: const Icon(Icons.check),
            tooltip: '저장',
            onPressed: _saveDiary,
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // GPS Location Fetch
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFEF3C7),
                foregroundColor: const Color(0xFF92400E),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              onPressed: _isLoadingGps ? null : _fetchCurrentGps,
              icon: _isLoadingGps 
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.my_location),
              label: Text(_isLoadingGps ? 'GPS 수신 중...' : '실시간 내 GPS 위치 가져오기'),
            ),
            const SizedBox(height: 14),

            // Region & Address
            TextFormField(
              controller: _regionController,
              decoration: const InputDecoration(labelText: '지역 / 코스 명칭 (예: 제주 애월)', border: OutlineInputBorder()),
              validator: (v) => v == null || v.isEmpty ? '지역 명칭을 입력해주세요.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _addressController,
              decoration: const InputDecoration(labelText: '상세 주소 또는 위치 설명', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 14),

            // Title & Content
            TextFormField(
              controller: _titleController,
              decoration: const InputDecoration(labelText: '일기 제목', border: OutlineInputBorder()),
              validator: (v) => v == null || v.isEmpty ? '제목을 입력해주세요.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _contentController,
              maxLines: 4,
              decoration: const InputDecoration(labelText: '여행 일기 내용', border: OutlineInputBorder()),
              validator: (v) => v == null || v.isEmpty ? '내용을 입력해주세요.' : null,
            ),
            const SizedBox(height: 16),

            // Weather & Rating
            const Text('날씨 & 만족도', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 8),
            Row(
              children: [
                // Weather Chips
                Expanded(
                  child: Wrap(
                    spacing: 6,
                    children: _weatherOptions.map((w) {
                      final isSelected = _selectedWeather == w['code'];
                      return ChoiceChip(
                        label: Text('\${w['icon']} \${w['label']}', style: const TextStyle(fontSize: 11)),
                        selected: isSelected,
                        selectedColor: const Color(0xFFFDE68A),
                        onSelected: (_) => setState(() => _selectedWeather = w['code']!),
                      );
                    }).toList(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            // Rating Stars
            Row(
              children: [
                const Text('만족도: ', style: TextStyle(fontSize: 13)),
                ...List.generate(5, (index) {
                  return IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    icon: Icon(
                      index < _rating ? Icons.star : Icons.star_border,
                      color: Colors.amber.shade700,
                      size: 24,
                    ),
                    onPressed: () => setState(() => _rating = index + 1),
                  );
                }),
              ],
            ),
            const SizedBox(height: 16),

            // Photos
            Row(
              mainAxisAlignment: MainAxisAlignment.between,
              children: [
                const Text('여행 사진 첨부', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.camera_alt, color: Color(0xFFD97706)),
                      tooltip: '카메라 촬영',
                      onPressed: () => _pickImage(ImageSource.camera),
                    ),
                    IconButton(
                      icon: const Icon(Icons.photo_library, color: Color(0xFFD97706)),
                      tooltip: '갤러리 선택',
                      onPressed: () => _pickImage(ImageSource.gallery),
                    ),
                  ],
                ),
              ],
            ),
            if (_photos.isNotEmpty)
              SizedBox(
                height: 70,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _photos.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (context, idx) {
                    return Stack(
                      children: [
                        Container(
                          width: 70,
                          height: 70,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(8),
                            color: Colors.grey.shade200,
                          ),
                          child: const Icon(Icons.image, color: Colors.grey),
                        ),
                        Positioned(
                          top: 2,
                          right: 2,
                          child: GestureDetector(
                            onTap: () => setState(() => _photos.removeAt(idx)),
                            child: Container(
                              padding: const EdgeInsets.all(2),
                              decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                              child: const Icon(Icons.close, size: 12, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            const SizedBox(height: 16),

            // Local Insights
            const Text('로컬 여행 인사이트', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 8),
            TextFormField(
              controller: _recommendController,
              decoration: const InputDecoration(labelText: '추천 이유 & 코스 특징', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _foodController,
              decoration: const InputDecoration(labelText: '현지 로컬 맛집 / 보급 추천', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _tipController,
              decoration: const InputDecoration(labelText: '나만의 여행 꿀팁', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 20),

            ElevatedButton(
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                backgroundColor: const Color(0xFFD97706),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: _saveDiary,
              child: Text(widget.initialEntry != null ? '일기 수정 완료' : '일기 등록하기', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}
`,

  location: `// lib/services/location_service.dart
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import '../models/diary_entry.dart';

class LocationService {
  static Future<GeoLocation> determineCurrentLocation() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw Exception('디바이스의 위치 서비스(GPS)가 꺼져 있습니다. 설정에서 활성화해주세요.');
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw Exception('위치 권한이 거부되었습니다.');
      }
    }

    if (permission == LocationPermission.deniedForever) {
      throw Exception('위치 권한이 영구적으로 거부되었습니다. 앱 설정에서 권한을 허용해주세요.');
    }

    final position = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
    );

    String address = '위도 \${position.latitude.toStringAsFixed(4)}, 경도 \${position.longitude.toStringAsFixed(4)}';
    String region = '현재 여행지';

    try {
      List<Placemark> placemarks = await placemarkFromCoordinates(
        position.latitude,
        position.longitude,
        localeIdentifier: 'ko_KR',
      );

      if (placemarks.isNotEmpty) {
        final place = placemarks.first;
        final admin = place.administrativeArea ?? '';
        final locality = place.locality ?? place.subAdministrativeArea ?? '';
        final subLocality = place.subLocality ?? '';
        final thoroughfare = place.thoroughfare ?? '';

        address = '$admin $locality $subLocality $thoroughfare'.trim();
        region = locality.isNotEmpty ? '$locality $subLocality'.trim() : admin;
      }
    } catch (_) {}

    return GeoLocation(
      lat: position.latitude,
      lng: position.longitude,
      accuracy: position.accuracy,
      address: address,
      region: region,
      isRealtimeGps: true,
    );
  }
}
`,

  firestore: `// lib/services/firestore_service.dart
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/diary_entry.dart';

class FirestoreService {
  final CollectionReference _collection =
      FirebaseFirestore.instance.collection('diaries');

  // 실시간 다이어리 목록 스트림
  Stream<List<DiaryEntry>> getDiariesStream() {
    return _collection
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map((doc) {
        final data = doc.data() as Map<String, dynamic>;
        return DiaryEntry.fromMap(data);
      }).toList();
    });
  }

  // 일기 저장 및 수정 (웹 앱과 실시간 동기화)
  Future<void> saveDiary(DiaryEntry entry) async {
    await _collection.doc(entry.id).set(entry.toMap(), SetOptions(merge: true));
  }

  // 일기 삭제
  Future<void> deleteDiary(String id) async {
    await _collection.doc(id).delete();
  }
}
`,

  readme: `# Hill's Blog - Flutter Mobile App

실시간 위치(GPS)와 카메라 사진을 연동하여 여행 발자취를 기록하는 크로스 플랫폼(iOS / Android) Flutter 모바일 앱 프로젝트입니다.

## 🚀 빠른 시작 가이드 (Quick Start)

### 1. Flutter SDK 확인
\`\`\`bash
flutter --version
flutter doctor
\`\`\`

### 2. 새 프로젝트 생성 & 본 소스 파일 덮어쓰기
\`\`\`bash
flutter create hills_blog_app
cd hills_blog_app
\`\`\`

본 프로젝트에 포함된 다음 파일들을 Flutter 프로젝트 디렉토리에 복사합니다:
- \`pubspec.yaml\`
- \`lib/main.dart\`
- \`lib/models/diary_entry.dart\`
- \`lib/services/location_service.dart\`
- \`lib/services/firestore_service.dart\`
- \`lib/screens/travel_map_screen.dart\`
- \`lib/screens/diary_editor_screen.dart\`

### 3. 패키지 의존성 설치
\`\`\`bash
flutter pub get
\`\`\`

### 4. 네이티브 권한 설정

#### Android (\`android/app/src/main/AndroidManifest.xml\`):
\`\`\`xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
\`\`\`

#### iOS (\`ios/Runner/Info.plist\`):
\`\`\`xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>여행 코스 및 실시간 여행 위치 기록을 위해 위치 권한이 필요합니다.</string>
<key>NSCameraUsageDescription</key>
<string>여행 순간을 촬영하여 일기에 첨부하기 위해 카메라 권한이 필요합니다.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>여행 갤러리 사진 첨부를 위해 사진 보관함 접근 권한이 필요합니다.</string>
\`\`\`

### 5. 실행
\`\`\`bash
flutter run
\`\`\`

## 📦 주요 기능
1. **블로그 피드**: 검색, 지역 필터, 만족도 별점, 날씨 및 감정 태그, 일기 상세 모달
2. **히스토리 지도**: OpenStreetMap 기반 이전 여행지 마커 및 Polyline 경로 궤적 시각화
3. **일기 작성/수정**: 실시간 GPS 좌표 및 한글 주소 자동 입력, 카메라/갤러리 사진 첨부
4. **Firebase 클라우드 연동**: Firestore를 통한 웹-모바일 실시간 일기 데이터 동기화
`
};
