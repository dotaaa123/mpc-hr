import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'save_file.dart';

const configuredUrl = String.fromEnvironment(
  'APP_URL',
  defaultValue: 'https://mpc-hr.vercel.app',
);
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DesktopApp());
}

class DesktopApp extends StatelessWidget {
  const DesktopApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ТҮР HR · MPC',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7656D8)),
    ),
    home: const DesktopHome(),
  );
}

class DesktopHome extends StatefulWidget {
  const DesktopHome({super.key});
  @override
  State<DesktopHome> createState() => _DesktopHomeState();
}

class _DesktopHomeState extends State<DesktopHome> {
  final input = TextEditingController();
  InAppWebViewController? webController;
  WebViewEnvironment? windowsEnvironment;
  String? url, error;
  bool busy = true;
  double progress = 0;
  SharedPreferences? preferences;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    try {
      preferences = await SharedPreferences.getInstance();
      input.text = preferences?.getString('serverUrl') ?? configuredUrl;
      if (input.text.trim().isNotEmpty) {
        await _open(input.text);
      } else if (mounted) {
        setState(() => busy = false);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e.toString();
          busy = false;
        });
      }
    }
  }

  Future<void> _prepareWindowsWebView() async {
    if (kIsWeb ||
        defaultTargetPlatform != TargetPlatform.windows ||
        windowsEnvironment != null) {
      return;
    }
    final version = await WebViewEnvironment.getAvailableVersion();
    if (version == null) {
      throw StateError('Microsoft Edge WebView2 Runtime суулгаагүй байна.');
    }
    final directory = await getApplicationSupportDirectory();
    windowsEnvironment = await WebViewEnvironment.create(
      settings: WebViewEnvironmentSettings(userDataFolder: directory.path),
    );
  }

  Future<void> _open(String value) async {
    final address = Uri.tryParse(value.trim());
    if (address == null ||
        !address.hasAuthority ||
        !(address.scheme == 'https' ||
            address.scheme == 'http' &&
                ['localhost', '127.0.0.1'].contains(address.host))) {
      setState(() {
        error = 'HTTPS вэб хаяг оруулна уу.';
        busy = false;
      });
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await _prepareWindowsWebView();
      await preferences?.setString('serverUrl', address.toString());
      if (mounted) {
        setState(() {
          url = address.toString();
          busy = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e.toString().replaceFirst('Bad state: ', '');
          busy = false;
        });
      }
    }
  }

  void _changeUrl() {
    setState(() {
      url = null;
      webController = null;
      error = null;
      busy = false;
    });
  }

  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CallbackShortcuts(
    bindings: {
      const SingleActivator(LogicalKeyboardKey.f5): () =>
          webController?.reload(),
      const SingleActivator(LogicalKeyboardKey.comma, control: true):
          _changeUrl,
    },
    child: Focus(
      autofocus: true,
      child: Scaffold(
        backgroundColor: const Color(0xFFF7F8FB),
        body: url != null
            ? SafeArea(
                child: Stack(
                  children: [
                    InAppWebView(
                      webViewEnvironment: windowsEnvironment,
                      initialUrlRequest: URLRequest(url: WebUri(url!)),
                      initialSettings: InAppWebViewSettings(
                        javaScriptEnabled: true,
                        supportMultipleWindows: false,
                        isInspectable: kDebugMode,
                      ),
                      onWebViewCreated: (controller) {
                        webController = controller;
                        controller.addJavaScriptHandler(
                          handlerName: 'mpcSaveExcel',
                          callback: (JavaScriptHandlerFunctionData data) async {
                            final page = Uri.tryParse(url ?? '');
                            final origin = Uri.tryParse(data.origin.toString());
                            if (!data.isMainFrame ||
                                page == null ||
                                origin == null ||
                                page.origin != origin.origin) {
                              return {'ok': false, 'error': 'Файлын эх сурвалж буруу'};
                            }
                            return saveExcelFile(data.args);
                          },
                        );
                      },
                      onProgressChanged: (_, value) {
                        if (mounted) setState(() => progress = value / 100);
                      },
                      onReceivedError: (_, request, webError) {
                        if (request.isForMainFrame == true && mounted) {
                          setState(
                            () => error =
                                'Вэб хуудсыг ачаалж чадсангүй: ${webError.description}',
                          );
                        }
                      },
                    ),
                    if (progress < 1)
                      LinearProgressIndicator(
                        value: progress == 0 ? null : progress,
                      ),
                    if (error != null)
                      Align(
                        alignment: Alignment.topCenter,
                        child: Material(
                          color: Colors.red.shade50,
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    error!,
                                    style: TextStyle(
                                      color: Colors.red.shade900,
                                    ),
                                  ),
                                ),
                                TextButton(
                                  onPressed: () => webController?.reload(),
                                  child: const Text('Дахин оролдох'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              )
            : Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text(
                            'ТҮР HR · MPC',
                            style: TextStyle(
                              color: Color(0xFF7656D8),
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'Вэб хаяг тохируулах',
                            style: TextStyle(
                              fontSize: 25,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'Байгууллагын вэб програмын HTTPS хаягийг оруулна уу. Бүх хуудас, үйлдэл, API холболт энэ цонхонд ижил ажиллана.',
                          ),
                          const SizedBox(height: 24),
                          TextField(
                            controller: input,
                            keyboardType: TextInputType.url,
                            onSubmitted: _open,
                            decoration: const InputDecoration(
                              labelText: 'Вэб хаяг',
                              hintText: 'https://your-project.vercel.app',
                              border: OutlineInputBorder(),
                            ),
                          ),
                          if (error != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              error!,
                              style: const TextStyle(color: Colors.red),
                            ),
                          ],
                          const SizedBox(height: 18),
                          FilledButton(
                            onPressed: busy ? null : () => _open(input.text),
                            child: busy
                                ? const CircularProgressIndicator()
                                : const Text('Нээх'),
                          ),
                          const SizedBox(height: 14),
                          const Text(
                            'Ctrl + , : хаяг өөрчлөх     F5 : дахин ачаалах',
                            style: TextStyle(fontSize: 11, color: Colors.grey),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
      ),
    ),
  );
}
