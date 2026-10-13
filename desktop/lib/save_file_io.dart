import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

Future<Map<String, Object?>> saveExcelFile(List<dynamic> args) async {
  try {
    if (args.length != 2 || args[0] is! String || args[1] is! String) {
      throw const FormatException('Файлын мэдээлэл буруу');
    }
    final name = args[0] as String;
    if (!RegExp(r'^[^\\/\x00-\x1f:<>|?*]+\.xlsx$', caseSensitive: false)
        .hasMatch(name)) {
      throw const FormatException('Excel файлын нэр буруу');
    }
    final encoded = args[1] as String;
    if (encoded.length > 28 * 1024 * 1024) {
      throw const FormatException('Excel файл 20 MB-аас их байна');
    }
    final bytes = base64Decode(encoded);
    final folder = await getDownloadsDirectory() ??
        await getApplicationDocumentsDirectory();
    await folder.create(recursive: true);
    final base = name.substring(0, name.length - 5);
    var file = File('${folder.path}${Platform.pathSeparator}$name');
    var suffix = 1;
    while (await file.exists()) {
      file = File('${folder.path}${Platform.pathSeparator}$base ($suffix).xlsx');
      suffix++;
    }
    await file.writeAsBytes(bytes, flush: true);
    return {'ok': true, 'path': file.path};
  } catch (error) {
    return {'ok': false, 'error': error.toString()};
  }
}
