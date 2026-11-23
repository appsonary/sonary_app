/**
 * Ponto único de composição/registro do provedor de mídia padrão.
 * Ao extrair o provedor para uma dependência externa no package.json,
 * basta atualizar o import abaixo.
 */

import {
  getMediaProviderHooks,
  hasRegisteredMediaProvider,
  registerMediaProvider,
  setMediaProviderBootstrap,
} from './mediaProvider';
import { createDefaultMediaProvider } from '../providers/default-media-provider';

export function ensureDefaultMediaProviderRegistered(): void {
  if (!hasRegisteredMediaProvider()) {
    registerMediaProvider(createDefaultMediaProvider(getMediaProviderHooks()));
  }
}

setMediaProviderBootstrap(ensureDefaultMediaProviderRegistered);
