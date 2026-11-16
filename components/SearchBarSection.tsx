import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ArrowLeft, ArrowUpLeft, History, Search, X } from 'lucide-react-native';
import { theme } from '../theme';

export interface SearchPillInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  clearAccessibilityLabel?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  showBackArrow?: boolean;
  onBackPress?: () => void;
  backAccessibilityLabel?: string;
  returnKeyType?: 'search' | 'done' | 'go' | 'next' | 'send';
  style?: StyleProp<ViewStyle>;
}

/** Barra de pesquisa em pílula padronizada do tema YouTube Music. */
export const SearchPillInput: React.FC<SearchPillInputProps> = ({
  value,
  onChangeText,
  placeholder = 'Buscar...',
  accessibilityLabel = 'Campo de busca',
  clearAccessibilityLabel = 'Limpar busca',
  onFocus,
  onBlur,
  onSubmitEditing,
  showBackArrow = false,
  onBackPress,
  backAccessibilityLabel = 'Voltar',
  returnKeyType = 'search',
  style,
}) => {
  const [internalFocused, setInternalFocused] = useState(false);

  return (
    <View
      style={[
        styles.searchBar,
        internalFocused && styles.searchBarFocused,
        style,
      ]}
    >
      {showBackArrow ? (
        <TouchableOpacity
          style={styles.leadingIconButton}
          onPress={onBackPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={backAccessibilityLabel}
        >
          <ArrowLeft color="#FFFFFF" size={20} />
        </TouchableOpacity>
      ) : (
        <Search color="#9E9EA4" size={20} />
      )}

      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor="#9A9A9A"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          setInternalFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setInternalFocused(false);
          onBlur?.();
        }}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        selectionColor={theme.colors.brandPrimary}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel}
      />

      {value.length > 0 && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => onChangeText('')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
        >
          <View style={styles.clearIconCircle}>
            <X color="#FFFFFF" size={13} />
          </View>
        </TouchableOpacity>
      )}
    </View>
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
}

export const SearchBarSection: React.FC<SearchBarSectionProps> = ({
  query,
  onChangeQuery,
  onSearch,
  isSearching,
  recentQueries = [],
  hasResults = false,
  onClearSearch,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const hasQuery = query.trim().length > 0;
  const showBackArrow = isFocused || hasResults;

  const filteredRecentQueries = useMemo(() => {
    if (!isFocused || recentQueries.length === 0) return [];
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? recentQueries.filter((item) => item.toLowerCase().includes(normalized))
      : recentQueries;
    return matches.slice(0, 8);
  }, [isFocused, query, recentQueries]);

  const handleSubmit = () => {
    setIsFocused(false);
    Keyboard?.dismiss?.();
    onSearch();
  };

  const handleLeadingPress = () => {
    if (isFocused) {
      setIsFocused(false);
      Keyboard?.dismiss?.();
      return;
    }
    if (hasResults) {
      onClearSearch?.();
    }
  };

  const handleSelectRecent = (item: string) => {
    onChangeQuery(item);
    setIsFocused(false);
    Keyboard?.dismiss?.();
    onSearch(item);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.searchContainer}>
        <View style={styles.searchBarSlot}>
          <SearchPillInput
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Buscar faixas, artistas ou álbuns..."
            accessibilityLabel="Campo de busca de músicas"
            clearAccessibilityLabel="Limpar busca"
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onSubmitEditing={handleSubmit}
            showBackArrow={showBackArrow}
            onBackPress={handleLeadingPress}
            backAccessibilityLabel={
              isFocused ? 'Fechar sugestões de busca' : 'Voltar para descoberta'
            }
          />
        </View>

        <TouchableOpacity
          style={[
            styles.searchButton,
            hasQuery ? styles.searchButtonActive : styles.searchButtonIdle,
            isSearching && styles.searchButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSearching}
          accessibilityRole="button"
          accessibilityLabel="Buscar músicas"
          activeOpacity={0.75}
        >
          {isSearching ? (
            <ActivityIndicator
              color={hasQuery ? theme.colors.textInverse : theme.colors.textPrimary}
              size="small"
            />
          ) : (
            <Search
              color={hasQuery ? '#030303' : '#FFFFFF'}
              size={20}
            />
          )}
        </TouchableOpacity>
      </View>

      {filteredRecentQueries.length > 0 && (
        <View style={styles.recentList} testID="search-history-list">
          {filteredRecentQueries.map((item) => (
            <TouchableOpacity
              key={item}
              style={styles.recentRow}
              onPress={() => handleSelectRecent(item)}
              activeOpacity={0.65}
              accessibilityRole="button"
              accessibilityLabel={`Buscar novamente ${item}`}
            >
              <History color="#D4D4D4" size={20} />
              <Text style={styles.recentQueryText} numberOfLines={1}>
                {item}
              </Text>
              <TouchableOpacity
                style={styles.fillArrowButton}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onChangeQuery(item);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Preencher busca com ${item}`}
              >
                <ArrowUpLeft color="#D4D4D4" size={20} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'transparent',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  searchBarSlot: {
    flex: 1,
  },
  searchBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#212121',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 14,
    height: 48,
    gap: 12,
  },
  searchBarFocused: {
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: '#282828',
  },
  leadingIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  searchButtonIdle: {
    backgroundColor: '#212121',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  searchButtonDisabled: {
    opacity: 0.7,
  },
  recentList: {
    paddingTop: 4,
    paddingBottom: 6,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    gap: 18,
  },
  recentQueryText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '400',
  },
  fillArrowButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SearchBarSection;
