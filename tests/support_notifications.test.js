// tests/support_notifications.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const App = require('../App').default;
const { SupportSection } = require('../components/SupportSection');
const {
  initDatabase,
  getTodayLocalDateKey,
  getNextMonthTenthDateKey,
  getSupportNotificationState,
  incrementDailySupportPlayCount,
  snoozeSupportNotificationsUntilNextMonth,
  canTriggerSupportNotification,
} = require('../services/database');
const {
  RealPlaytimeTracker,
  SUPPORT_NOTIFICATION_CHANNEL_ID,
  getSupportNotificationContent,
  getTargetTabFromNotificationResponse,
  triggerSupportNotificationIfEligible,
} = require('../services/supportNotifications');
const {
  actAsync,
  findButtonByText,
  getAllText,
  resetAllMocks,
} = require('./helpers/testUtils');
const notificationsMock = require('./mocks/notificationsMock');
const { AppState, Linking } = require('./mocks/reactNativeMock');
const { mockPlayer } = require('./mocks/trackPlayerMock');

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test('RealPlaytimeTracker: ignores skips < 30s and seeks, counts >= 30s and repeats', () => {
  const tracker = new RealPlaytimeTracker();

  // Pulo rápido aos 28s e troca de faixa não conta
  for (let sec = 1; sec <= 28; sec++) {
    assert.strictEqual(tracker.recordProgressSample('track-a', sec), false);
  }
  assert.strictEqual(tracker.recordProgressSample('track-b', 1), false);

  // Seek brusco (1s -> 45s) não conta como 44s ouvidos
  assert.strictEqual(tracker.recordProgressSample('track-b', 45), false);
  // Continua ouvindo continuamente por mais 28s (1s acumulado + 28s = 29s) -> ainda não
  for (let sec = 46; sec <= 73; sec++) {
    assert.strictEqual(tracker.recordProgressSample('track-b', sec), false);
  }
  // No 30º segundo real acumulado (74s) contabiliza exatamente uma vez
  assert.strictEqual(tracker.recordProgressSample('track-b', 74), true);
  assert.strictEqual(tracker.recordProgressSample('track-b', 75), false);

  // Repetição em loop da mesma faixa volta a contar após novos >= 30s reais
  assert.strictEqual(tracker.recordProgressSample('track-b', 1), false);
  for (let sec = 2; sec <= 29; sec++) {
    assert.strictEqual(tracker.recordProgressSample('track-b', sec), false);
  }
  assert.strictEqual(tracker.recordProgressSample('track-b', 30), true);
});

test('Trigger rule: dispatches only on > 15 plays (16th) and at most once per day', async () => {
  const day = new Date(2026, 10, 15, 14, 0, 0); // 2026-11-15 (dia ímpar)

  for (let i = 1; i <= 15; i++) {
    await incrementDailySupportPlayCount(day);
    const fired = await triggerSupportNotificationIfEligible(day);
    assert.strictEqual(fired, false, `Should not fire on play #${i}`);
  }
  assert.strictEqual(notificationsMock.__getState().scheduledNotifications.length, 0);

  // 16ª reprodução real -> dispara imediatamente
  const state16 = await incrementDailySupportPlayCount(day);
  assert.strictEqual(state16.dailyPlayCount, 16);
  assert.strictEqual(await triggerSupportNotificationIfEligible(day), true);

  const scheduled = notificationsMock.__getState().scheduledNotifications;
  assert.strictEqual(scheduled.length, 1);
  assert.deepStrictEqual(scheduled[0].content.data, { targetTab: 'support' });
  assert.strictEqual(scheduled[0].content.sound, false);
  assert.strictEqual(scheduled[0].trigger.channelId, SUPPORT_NOTIFICATION_CHANNEL_ID);
  assert.strictEqual(scheduled[0].trigger.seconds, 1);
  assert.strictEqual(scheduled[0].trigger.repeats, false);

  // 17ª reprodução no mesmo dia -> bloqueado pela trava diária
  await incrementDailySupportPlayCount(day);
  assert.strictEqual(await triggerSupportNotificationIfEligible(day), false);
  assert.strictEqual(notificationsMock.__getState().scheduledNotifications.length, 1);
});

test('Day rollover: resets dailyPlayCount automatically on new local calendar day', async () => {
  const day1 = new Date(2026, 10, 15, 23, 55, 0);
  const day2 = new Date(2026, 10, 16, 0, 5, 0);

  for (let i = 0; i < 16; i++) {
    await incrementDailySupportPlayCount(day1);
  }
  assert.strictEqual(await triggerSupportNotificationIfEligible(day1), true);

  // Virada de meia-noite local zera contagem do dia
  const rolledState = await getSupportNotificationState(day2);
  assert.strictEqual(rolledState.dateKey, getTodayLocalDateKey(day2));
  assert.strictEqual(rolledState.dailyPlayCount, 0);
  assert.strictEqual(canTriggerSupportNotification(rolledState, day2), false);

  // Precisa novamente > 15 reproduções no novo dia
  for (let i = 1; i <= 15; i++) {
    await incrementDailySupportPlayCount(day2);
    assert.strictEqual(await triggerSupportNotificationIfEligible(day2), false);
  }
  await incrementDailySupportPlayCount(day2);
  assert.strictEqual(await triggerSupportNotificationIfEligible(day2), true);
  assert.strictEqual(notificationsMock.__getState().scheduledNotifications.length, 2);
});

test('Pix copy snooze: locks until 10th of next month (day 05, day 15, Dec->Jan rollover)', async () => {
  // Cópia no dia 05/12/2026 -> bloqueado até 10/01/2027
  assert.strictEqual(getNextMonthTenthDateKey(new Date(2026, 11, 5)), '2027-01-10');
  // Cópia no dia 15/12/2026 -> bloqueado até 10/01/2027
  assert.strictEqual(getNextMonthTenthDateKey(new Date(2026, 11, 15)), '2027-01-10');
  // Cópia no dia 31/01/2026 -> não sofre overflow de mês para março
  assert.strictEqual(getNextMonthTenthDateKey(new Date(2026, 0, 31)), '2026-02-10');

  const dec15 = new Date(2026, 11, 15, 10, 0, 0);
  await snoozeSupportNotificationsUntilNextMonth(dec15);

  const dec20 = new Date(2026, 11, 20, 12, 0, 0);
  const jan09 = new Date(2027, 0, 9, 12, 0, 0);
  const jan10 = new Date(2027, 0, 10, 12, 0, 0);

  for (let i = 0; i < 16; i++) {
    await incrementDailySupportPlayCount(dec20);
  }
  assert.strictEqual(await triggerSupportNotificationIfEligible(dec20), false);

  for (let i = 0; i < 16; i++) {
    await incrementDailySupportPlayCount(jan09);
  }
  assert.strictEqual(await triggerSupportNotificationIfEligible(jan09), false);

  // No dia 10/01/2027 a trava expira e permite notificar novamente
  for (let i = 0; i < 16; i++) {
    await incrementDailySupportPlayCount(jan10);
  }
  assert.strictEqual(await triggerSupportNotificationIfEligible(jan10), true);
});

test('SupportSection UI: rendering Apoiar without copying does not snooze; clicking Copy Pix activates snooze', async () => {
  let toast = null;
  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(SupportSection, {
        showPixSupport: true,
        onShowToast: (msg) => {
          toast = msg;
        },
      })
    );
  });

  // Apenas abrir a aba Apoiar não grava snoozeUntilDate
  const beforeCopy = await getSupportNotificationState();
  assert.strictEqual(beforeCopy.snoozeUntilDate, null);

  // Clicar no botão Copiar código Pix ativa a trava mensal até dia 10 do próximo mês
  const copyBtn = findButtonByText(tree.root, 'Copiar código Pix');
  assert.ok(copyBtn, 'Copiar código Pix button should exist');
  await actAsync(async () => {
    await copyBtn.props.onPress();
  });

  assert.strictEqual(toast, 'Código Pix copiado!');
  const afterCopy = await getSupportNotificationState();
  assert.strictEqual(afterCopy.snoozeUntilDate, getNextMonthTenthDateKey(new Date()));

  await actAsync(async () => {
    tree.unmount();
  });
});

test('Android channel LOW silent config, denied permission skip, and alternating A/B copy', async () => {
  const copyOdd = getSupportNotificationContent(new Date(2026, 10, 15));
  assert.strictEqual(copyOdd.title, 'Obrigado por ouvir no Sonary ❤️');
  assert.strictEqual(
    copyOdd.body,
    'O app segue 100% grátis e sem anúncios. Se ele faz parte do seu dia, conheça a aba Apoiar.'
  );

  const copyEven = getSupportNotificationContent(new Date(2026, 10, 16));
  assert.strictEqual(copyEven.title, 'Curtiu suas músicas de hoje?');
  assert.strictEqual(
    copyEven.body,
    'O Sonary é mantido de forma independente. Toque aqui se quiser apoiar o projeto.'
  );

  // Com permissão negada, ignora silenciosamente sem agendar
  const oddDay = new Date(2026, 10, 15, 18, 0, 0);
  for (let i = 0; i < 16; i++) {
    await incrementDailySupportPlayCount(oddDay);
  }
  notificationsMock.__setPermissionGranted(false);
  assert.strictEqual(await triggerSupportNotificationIfEligible(oddDay), false);
  assert.strictEqual(notificationsMock.__getState().scheduledNotifications.length, 0);

  // Com permissão concedida, cria canal LOW silencioso e envia copy esperada
  notificationsMock.__setPermissionGranted(true);
  assert.strictEqual(await triggerSupportNotificationIfEligible(oddDay), true);

  const channel = await notificationsMock.getNotificationChannelAsync(
    SUPPORT_NOTIFICATION_CHANNEL_ID
  );
  assert.ok(channel, 'Android support channel must be configured');
  assert.strictEqual(channel.importance, notificationsMock.AndroidImportance.LOW);
  assert.strictEqual(channel.sound, null);
  assert.strictEqual(channel.enableVibrate, false);
  assert.strictEqual(channel.vibrationPattern, null);

  const sent = notificationsMock.__getState().scheduledNotifications[0];
  assert.strictEqual(sent.content.title, copyOdd.title);
  assert.strictEqual(sent.content.body, copyOdd.body);
});

test('Notification tap in background navigates to Apoiar and closes open NowPlaying modal', async () => {
  await actAsync(async () => {
    await mockPlayer.add({
      id: 'track-now-1',
      url: 'https://example.com/audio.mp3',
      title: 'Faixa em Execução',
      artist: 'Artista Teste',
      duration: 180,
    });
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  // Abre o modal NowPlaying clicando no mini-player
  const miniPlayerBtn = tree.root.find(
    (n) =>
      n.type === 'TouchableOpacity' &&
      n.props &&
      n.props.onPress &&
      getAllText(n).includes('Faixa em Execução') &&
      !n.props.accessibilityLabel?.includes('Reproduzir') &&
      !n.props.accessibilityLabel?.includes('Pausar')
  );
  await actAsync(async () => {
    miniPlayerBtn.props.onPress();
  });

  // Confirma que modal NowPlaying está visível antes do toque na notificação
  const modalBefore = tree.root.find((n) => n.type === 'Modal');
  assert.ok(modalBefore, 'NowPlaying modal should be visible before notification tap');

  // Simula toque na notificação com app em segundo plano
  await actAsync(async () => {
    notificationsMock.__emitNotificationResponse({
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: {
        request: {
          identifier: 'bg-support-1',
          content: { data: { targetTab: 'support' } },
        },
      },
    });
  });

  const screenText = getAllText(tree.root);
  assert.ok(screenText.includes('Apoie o Sonary'), 'Should navigate to support tab');
  const openModals = tree.root.findAll((n) => n.type === 'Modal');
  assert.strictEqual(openModals.length, 0, 'Overlapping modals must close on notification tap');

  await actAsync(async () => {
    tree.unmount();
  });
});

test('Notification tap on cold start opens Apoiar tab directly', async () => {
  notificationsMock.__setLastNotificationResponse({
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      request: {
        identifier: 'cold-support-1',
        content: { data: { targetTab: 'support' } },
      },
    },
  });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const screenText = getAllText(tree.root);
  assert.ok(screenText.includes('Apoie o Sonary'), 'Cold start should open Apoiar tab');

  await actAsync(async () => {
    tree.unmount();
  });
});

test('Dev menu button: hidden when __DEV__ is false/undefined, opens DevMenuModal and tests notifications when __DEV__ is true', async () => {
  const { SideDrawerMenu } = require('../components/SideDrawerMenu');
  const { DevMenuModal } = require('../components/DevMenuModal');
  const prevDev = global.__DEV__;

  try {
    // 1. Produção (__DEV__ = false): item dev no drawer e modal NÃO existem
    global.__DEV__ = false;
    let prodTree;
    await actAsync(async () => {
      prodTree = renderer.create(React.createElement(App));
    });
    const prodMenuBtn = prodTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir menu'
    );
    await actAsync(async () => {
      prodMenuBtn.props.onPress();
    });
    const prodDevBtns = prodTree.root.findAll(
      (n) => n.props && n.props.accessibilityLabel === 'Modo Desenvolvedor'
    );
    assert.strictEqual(prodDevBtns.length, 0, 'Dev item must not exist in production');

    let prodDrawerTree;
    await actAsync(async () => {
      prodDrawerTree = renderer.create(
        React.createElement(SideDrawerMenu, {
          visible: true,
          isDevMode: false,
          onClose: () => {},
          onOpenDownloadQueue: () => {},
          onOpenRecentHistory: () => {},
          onOpenStats: () => {},
          onOpenUpdates: () => {},
          onOpenSettings: () => {},
          onOpenDevMenu: () => {},
          onOpenSupport: () => {},
        })
      );
    });
    assert.strictEqual(
      prodDrawerTree.root.findAll(
        (n) => n.props && n.props.accessibilityLabel === 'Modo Desenvolvedor'
      ).length,
      0
    );

    let prodModalTree;
    await actAsync(async () => {
      prodModalTree = renderer.create(
        React.createElement(DevMenuModal, { visible: true, onClose: () => {} })
      );
    });
    assert.strictEqual(prodModalTree.toJSON(), null, 'DevMenuModal must render null outside dev');

    await actAsync(async () => {
      prodTree.unmount();
      prodDrawerTree.unmount();
      prodModalTree.unmount();
    });

    // 2. Desenvolvimento (__DEV__ = true): item no menu lateral abre DevMenuModal e testa notificações
    global.__DEV__ = true;
    let devTree;
    await actAsync(async () => {
      devTree = renderer.create(React.createElement(App));
    });

    const devMenuOpenBtn = devTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir menu'
    );
    await actAsync(async () => {
      devMenuOpenBtn.props.onPress();
    });

    const devBtn = devTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Modo Desenvolvedor'
    );
    assert.ok(devBtn, 'Dev menu item with Code2 icon should render when __DEV__ is true');

    await actAsync(async () => {
      devBtn.props.onPress();
    });

    assert.ok(getAllText(devTree.root).includes('Menu Dev'), 'DevMenuModal should open');

    const simOneBtn = findButtonByText(devTree.root, 'Simular +1 música (>= 30s)');
    assert.ok(simOneBtn);
    await actAsync(async () => {
      await simOneBtn.props.onPress();
    });
    assert.strictEqual((await getSupportNotificationState()).dailyPlayCount, 1);

    const forceBtn = findButtonByText(devTree.root, 'Enviar notificação agora (forçar)');
    assert.ok(forceBtn);
    await actAsync(async () => {
      await forceBtn.props.onPress();
    });
    assert.strictEqual(notificationsMock.__getState().scheduledNotifications.length, 1);

    const varABtn = findButtonByText(devTree.root, 'Testar Variação A');
    const varBBtn = findButtonByText(devTree.root, 'Testar Variação B');
    assert.ok(varABtn && varBBtn);
    await actAsync(async () => {
      await varABtn.props.onPress();
      await varBBtn.props.onPress();
    });
    const scheduledAfterAB = notificationsMock.__getState().scheduledNotifications;
    assert.strictEqual(scheduledAfterAB.length, 3);
    assert.strictEqual(scheduledAfterAB[1].content.title, 'Obrigado por ouvir no Sonary ❤️');
    assert.strictEqual(scheduledAfterAB[2].content.title, 'Curtiu suas músicas de hoje?');

    const reach16Btn = findButtonByText(devTree.root, 'Completar 16ª e testar regra');
    assert.ok(reach16Btn);
    await actAsync(async () => {
      await reach16Btn.props.onPress();
    });
    assert.strictEqual((await getSupportNotificationState()).dailyPlayCount, 16);
    assert.strictEqual(notificationsMock.__getState().scheduledNotifications.length, 4);

    const resetBtn = findButtonByText(devTree.root, 'Resetar contador e travas');
    assert.ok(resetBtn);
    await actAsync(async () => {
      await resetBtn.props.onPress();
    });
    assert.strictEqual((await getSupportNotificationState()).dailyPlayCount, 0);

    await actAsync(async () => {
      devTree.unmount();
    });
  } finally {
    if (prevDev === undefined) {
      delete global.__DEV__;
    } else {
      global.__DEV__ = prevDev;
    }
  }
});

test('Notification fallback: dataString JSON parsing, Linking cold start, AppState resume and deduplication', async () => {
  // 1. Parser aceita dataString (fallback nativo quando data vem serializado)
  assert.strictEqual(
    getTargetTabFromNotificationResponse({
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: {
        request: {
          identifier: 'datastring-only-1',
          content: { dataString: JSON.stringify({ targetTab: 'support' }) },
        },
      },
    }),
    'support'
  );

  // 2. Cold start via deep link injetado pela MainActivity abre diretamente a aba Apoiar
  Linking.__setInitialUrl('com.sonarypro.app://support?nid=deeplink-cold-1');
  let coldTree;
  await actAsync(async () => {
    coldTree = renderer.create(React.createElement(App));
  });
  assert.ok(
    getAllText(coldTree.root).includes('Apoie o Sonary'),
    'Cold start via com.sonarypro.app://support deep link should open Apoiar tab'
  );
  await actAsync(async () => {
    coldTree.unmount();
  });

  // 3. Em background na aba Buscar, deep link ou retorno ao foreground abre Apoiar e evita duplicar pelo mesmo nid
  Linking.__setInitialUrl(null);
  let bgTree;
  await actAsync(async () => {
    bgTree = renderer.create(React.createElement(App));
  });
  assert.ok(!getAllText(bgTree.root).includes('Apoie o Sonary'));

  await actAsync(async () => {
    Linking.__emitUrl('com.sonarypro.app://support?nid=deeplink-warm-1');
  });
  assert.ok(getAllText(bgTree.root).includes('Apoie o Sonary'));

  // Volta para Buscar e garante que a chegada tardia da mesma notificação (mesmo nid) não força troca indevida
  const searchTabBtn = findButtonByText(bgTree.root, 'Buscar');
  await actAsync(async () => {
    searchTabBtn.props.onPress();
  });
  assert.ok(!getAllText(bgTree.root).includes('Apoie o Sonary'));

  await actAsync(async () => {
    notificationsMock.__emitNotificationResponse({
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: {
        request: {
          identifier: 'deeplink-warm-1',
          content: { data: { targetTab: 'support' } },
        },
      },
    });
  });
  assert.ok(!getAllText(bgTree.root).includes('Apoie o Sonary'));

  // 4. Quando lastNotificationResponse só fica disponível ao retornar para active (AppState), navega para Apoiar
  notificationsMock.__setLastNotificationResponse({
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      request: {
        identifier: 'appstate-late-1',
        content: { dataString: JSON.stringify({ targetTab: 'support' }) },
      },
    },
  });
  await actAsync(async () => {
    AppState.__emitState('active');
  });
  assert.ok(getAllText(bgTree.root).includes('Apoie o Sonary'));

  await actAsync(async () => {
    bgTree.unmount();
  });
});

test('APK build profiles: EXPO_PUBLIC_DEV_MENU=1 enables dev button in APK dev build and prod hides it', async () => {
  const path = require('path');
  const vm = require('vm');
  const babel = require('@babel/core');
  const { resolveBuildEnv } = require('../scripts/build-apk');

  const devEnv = resolveBuildEnv('dev', { PATH: 'x', EXPO_PUBLIC_DEV_MENU: '0' });
  const prodEnv = resolveBuildEnv('prod', { PATH: 'x', EXPO_PUBLIC_DEV_MENU: '1' });
  assert.strictEqual(devEnv.EXPO_PUBLIC_DEV_MENU, '1');
  assert.strictEqual(prodEnv.EXPO_PUBLIC_DEV_MENU, undefined);

  const envKey = 'EXPO_PUBLIC_DEV_MENU';
  const prevDev = global.__DEV__;
  const prevFlag = process.env[envKey];

  const evalDevMenuEnabled = (flagValue) => {
    if (flagValue === undefined) delete process.env[envKey];
    else process.env[envKey] = flagValue;

    const modalFile = path.resolve(__dirname, '../components/DevMenuModal.tsx');
    const transformed = babel.transformFileSync(modalFile, {
      configFile: path.resolve(__dirname, '../babel.config.js'),
    });
    const fakeModule = { exports: {} };
    const stubReq = (id) => {
      if (id === 'react') return React;
      if (id === 'react-native') return { StyleSheet: { create: (s) => s } };
      if (id === 'lucide-react-native' || id.startsWith('..')) return {};
      return require(id);
    };
    vm.runInNewContext(transformed.code, {
      module: fakeModule,
      exports: fakeModule.exports,
      require: stubReq,
      process: { env: {} },
      __DEV__: false,
    });
    return fakeModule.exports.isDevMenuEnabled();
  };

  try {
    assert.strictEqual(
      evalDevMenuEnabled('1'),
      true,
      'Babel compile with EXPO_PUBLIC_DEV_MENU=1 must inline true even with __DEV__=false'
    );
    assert.strictEqual(
      evalDevMenuEnabled(undefined),
      false,
      'Babel compile in prod without EXPO_PUBLIC_DEV_MENU must inline false when __DEV__=false'
    );

    global.__DEV__ = false;
    delete process.env[envKey];
    let apkProdTree;
    await actAsync(async () => {
      apkProdTree = renderer.create(React.createElement(App));
    });
    const apkMenuBtn = apkProdTree.root.find(
      (n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Abrir menu'
    );
    await actAsync(async () => {
      apkMenuBtn.props.onPress();
    });
    assert.strictEqual(
      apkProdTree.root.findAll(
        (n) => n.props && n.props.accessibilityLabel === 'Modo Desenvolvedor'
      ).length,
      0,
      'Prod APK (__DEV__=false without EXPO_PUBLIC_DEV_MENU) must hide dev menu item'
    );
    await actAsync(async () => {
      apkProdTree.unmount();
    });
  } finally {
    if (prevDev === undefined) delete global.__DEV__;
    else global.__DEV__ = prevDev;
    if (prevFlag === undefined) delete process.env[envKey];
    else process.env[envKey] = prevFlag;
  }
});


