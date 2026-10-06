sed -i '629,663c\
                <label\
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-white text-xs font-medium transition cursor-pointer"\
                  title="카메라로 실시간 촬영하기"\
                >\
                  <input\
                    type="file"\
                    onChange={(e) => handlePhotoFiles(e.target.files)}\
                    accept="image/*"\
                    capture="environment"\
                    className="sr-only"\
                    name="cameraInput"\
                  />\
                  <Camera className="w-3.5 h-3.5 text-amber-400" />\
                  <span>카메라 촬영</span>\
                </label>\
                <label\
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition shadow-sm cursor-pointer"\
                >\
                  <input\
                    type="file"\
                    onChange={(e) => handlePhotoFiles(e.target.files)}\
                    accept="image/*"\
                    multiple\
                    className="sr-only"\
                    name="photoInput"\
                  />\
                  <Upload className="w-3.5 h-3.5" />\
                  <span>사진 업로드</span>\
                </label>\
' src/components/DiaryEditorModal.tsx
