import JSZip from 'jszip';
import { FLUTTER_CODE_SNIPPETS } from './flutterSnippets';

export const DIARY_EDITOR_SCREEN_CODE = FLUTTER_CODE_SNIPPETS.editor;
export const FLUTTER_README = FLUTTER_CODE_SNIPPETS.readme;

/**
 * Creates and triggers download of the complete Flutter project as a .zip file
 */
export async function downloadFlutterProjectZip(): Promise<void> {
  const zip = new JSZip();

  // Root files
  zip.file('pubspec.yaml', FLUTTER_CODE_SNIPPETS.pubspec);
  zip.file('README.md', FLUTTER_CODE_SNIPPETS.readme);
  zip.file(
    'analysis_options.yaml',
    `include: package:flutter_lints/flutter.yaml

linter:
  rules:
    prefer_const_constructors: true
    prefer_const_declarations: true
`
  );
  zip.file(
    '.gitignore',
    `# Flutter .gitignore
.dart_tool/
.packages
build/
.pub-cache/
.pub/
*.iml
.idea/
`
  );

  // lib directory
  const lib = zip.folder('lib');
  if (lib) {
    lib.file('main.dart', FLUTTER_CODE_SNIPPETS.main);

    const models = lib.folder('models');
    if (models) {
      models.file('diary_entry.dart', FLUTTER_CODE_SNIPPETS.models);
    }

    const services = lib.folder('services');
    if (services) {
      services.file('location_service.dart', FLUTTER_CODE_SNIPPETS.location);
      services.file('firestore_service.dart', FLUTTER_CODE_SNIPPETS.firestore);
    }

    const screens = lib.folder('screens');
    if (screens) {
      screens.file('travel_map_screen.dart', FLUTTER_CODE_SNIPPETS.screens);
      screens.file('diary_editor_screen.dart', FLUTTER_CODE_SNIPPETS.editor);
    }
  }

  // Generate ZIP file blob
  const blob = await zip.generateAsync({ type: 'blob' });
  
  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hills_blog_flutter_app.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
