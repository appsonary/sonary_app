import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { playbackService } from './service';

// Desativa banners flutuantes de LogBox (PopupWindows nativos) que interferem nas transições de janela do Android 14
LogBox.ignoreAllLogs(true);

/**
 * Ponto de Entrada do Aplicativo (Expo SDK 51+)
 * 
 * O registro do TrackPlayer PlaybackService DEVE ser executado fora
 * e antes da montagem da árvore React (registerRootComponent).
 * Isso garante que o Android Foreground Service possa instanciar e
 * controlar a sessão de mídia mesmo se o app for acordado em segundo plano.
 */
TrackPlayer.registerPlaybackService(() => playbackService);

// Inicializa a aplicação React Native
registerRootComponent(App);
