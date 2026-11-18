import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ArrowUpLeft, History, Search, X } from 'lucide-react-native';
import { MaterialTextInput } from './MaterialTextInput';
import { BACK_PRIORITY, useBackHandler } from '../services/backNavigation';

export interface SearchPillInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  clearAccessibilityLabel?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  onSearchPress?: () => void;
  isSearching?: boolean;
  searchAccessibilityLabel?: string;
  returnKeyType?: 'search' | 'done' | 'go' | 'next' | 'send';
  style?: StyleProp<ViewStyle>;
  inputRef?: React.RefObject<TextInput | null>;
}

/** Barra de pesquisa minimalista estilo Material com sublinhado crimson animado. */
export const SearchPillInput: React.FC<SearchPillInputProps> = ({
  value,
  onChangeText,
  placeholder = 'Buscar...',
  accessibilityLabel = 'Campo de busca',
  clearAccessibilityLabel = 'Limpar busca',
  onFocus,
  onBlur,
  onSubmitEditing,
  onSearchPress,
  isSearching = false,
  searchAccessibilityLabel = 'Buscar músicas',
  returnKeyType = 'search',
  style,
  inputRef,
}) => {
  const leftAccessory = onSearchPress ? (
    <TouchableOpacity
      style={[
        styles.leadingIconButton,
        isSearching && styles.searchButtonDisabled,
      ]}
      onPress={onSearchPress}
      disabled={isSearching}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={searchAccessibilityLabel}
      activeOpacity={0.7}
    >
      {isSearching ? (
        <ActivityIndicator color="#9E9EA4" size="small" />
      ) : (
        <Search color="#9E9EA4" size={18} />
      )}
    </TouchableOpacity>
  ) : (
    <Search color="#9E9EA4" size={18} />
  );

  return (
    <MaterialTextInput
      ref={inputRef as React.Ref<TextInput>}
      containerStyle={[styles.searchBar, style]}
      inputStyle={styles.searchInput}
      leftAccessory={leftAccessory}
      placeholder={placeholder}
      value={value}
      onChangeText={onChangeText}
      onFocus={onFocus}
      onBlur={onBlur}
      onSubmitEditing={onSubmitEditing}
      returnKeyType={returnKeyType}
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={accessibilityLabel}
      clearAccessibilityLabel={clearAccessibilityLabel}
    />
  );
};

export interface SearchBarSectionProps {
  query: string;
  onChangeQuery: (text: string) => void;
  onSearch: (overrideQuery?: string) => void;
  isSearching: boolean;
  recentQueries?: string[];
  hasResults?: boolean;
  onClearSearch?: () => void;
  onFocusChange?: (focused: boolean) => void;
  onRemoveRecentQuery?: (item: string) => void;
  onClearHistory?: () => void;
}

export const SearchBarSection: React.FC<SearchBarSectionProps> = ({
  query,
  onChangeQuery,
  onSearch,
  isSearching,
  recentQueries = [],
  hasResults = false,
  onClearSearch,
  onFocusChange,
  onRemoveRecentQuery,
  onClearHistory,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const searchInputRef = useRef<TextInput | null>(null);
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;

  const updateFocus = (nextFocused: boolean) => {
    setIsFocused(nextFocused);
    onFocusChangeRef.current?.(nextFocused);
  };

  useEffect(() => {
    const showSub = Keyboard?.addListener?.('keyboardDidShow', (event: any) => {
      const height = event?.endCoordinates?.height;
      setKeyboardHeight(typeof height === 'number' && height > 0 ? height : 0);
    });
    const hideSub = Keyboard?.addListener?.('keyboardDidHide', () => {
      setKeyboardHeight(0);
      updateFocus(false);
      // Desfoca o EditText nativo no Android para que o próximo toque dispare onFocus novamente
      searchInputRef.current?.blur?.();
    });
    return () => {
      showSub?.remove?.();
      hideSub?.remove?.();
    };
  }, []);

  useBackHandler(
    isFocused,
    () => {
      updateFocus(false);
      searchInputRef.current?.blur?.();
      Keyboard?.dismiss?.();
      return true;
    },
    BACK_PRIORITY.INLINE_OVERLAY
  );

  useBackHandler(
    Boolean(hasResults && !isFocused && onClearSearch),
    () => {
      onClearSearch?.();
      return true;
    },
    BACK_PRIORITY.SUBSCREEN_MODE
  );

  const filteredRecentQueries = useMemo(() => {
    if (!isFocused || recentQueries.length === 0) return [];
    const normalized = query.trim().toLowerCase();
    return normalized
      ? recentQueries.filter((item) => item.toLowerCase().includes(normalized))
      : recentQueries;
  }, [isFocused, query, recentQueries]);

  const handleSubmit = () => {
    updateFocus(false);
    searchInputRef.current?.blur?.();
    Keyboard?.dismiss?.();
    onSearch();
  };

  const handleSelectRecent = (item: string) => {
    onChangeQuery(item);
    updateFocus(false);
    searchInputRef.current?.blur?.();
    Keyboard?.dismiss?.();
    onSearch(item);
  };

  return (
    <View style={[styles.wrapper, isFocused && styles.wrapperFocused]}>
      <View style={styles.searchContainer}>
        <SearchPillInput
          inputRef={searchInputRef}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Buscar faixas, artistas ou álbuns..."
          accessibilityLabel="Campo de busca de músicas"
          clearAccessibilityLabel="Limpar busca"
          onFocus={() => updateFocus(true)}
          onBlur={() => updateFocus(false)}
          onSubmitEditing={handleSubmit}
          onSearchPress={handleSubmit}
          isSearching={isSearching}
          searchAccessibilityLabel="Buscar músicas"
        />
      </View>

      {isFocused && (
        <ScrollView
          style={styles.recentList}
          contentContainerStyle={[
            styles.recentListContent,
            { paddingBottom: Math.max(140, keyboardHeight + 24) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
          testID="search-history-list"
        >
          {recentQueries.length > 0 && (
            <View style={styles.recentHeader}>
              <Text style={styles.recentHeaderTitle}>Buscas recentes</Text>
              {onClearHistory && (
                <TouchableOpacity
                  style={styles.clearAllButton}
                  onPress={onClearHistory}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Limpar histórico de buscas"
                >
                  <Text style={styles.clearAllText}>Limpar tudo</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {filteredRecentQueries.length > 0 ? (
            filteredRecentQueries.map((item) => (
              <TouchableOpacity
                key={item}
                style={styles.recentRow}
                onPress={() => handleSelectRecent(item)}
                activeOpacity={0.65}
                accessibilityRole="button"
                accessibilityLabel={`Buscar novamente ${item}`}
              >
                <History color="#8E8E93" size={20} />
                <Text style={styles.recentQueryText} numberOfLines={1}>
                  {item}
                </Text>
                <TouchableOpacity
                  style={styles.rowActionButton}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onChangeQuery(item);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Preencher busca com ${item}`}
                >
                  <ArrowUpLeft color="#8E8E93" size={20} />
                </TouchableOpacity>
                {onRemoveRecentQuery && (
                  <TouchableOpacity
                    style={styles.rowActionButton}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onRemoveRecentQuery(item);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remover busca ${item}`}
                  >
                    <X color="#8E8E93" size={18} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyHistoryBox} testID="search-history-empty">
              <Text style={styles.emptyHistoryText}>
                {recentQueries.length === 0
                  ? 'Suas buscas recentes aparecerão aqui'
                  : 'Nenhuma busca recente correspondente'}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'transparent',
  },
  wrapperFocused: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  searchBar: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  leadingIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    fontSize: 16,
    paddingVertical: 8,
  },
  searchButtonDisabled: {
    opacity: 0.7,
  },
  recentList: {
    flex: 1,
  },
  recentListContent: {
    paddingTop: 6,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
  },
  recentHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  clearAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  clearAllText: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '600',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 16,
  },
  recentQueryText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '400',
  },
  rowActionButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHistoryBox: {
    paddingHorizontal: 18,
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyHistoryText: {
    color: '#717171',
    fontSize: 14,
  },
});

export default SearchBarSection;
