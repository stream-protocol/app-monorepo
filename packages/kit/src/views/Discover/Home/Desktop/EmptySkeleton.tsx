import { useCallback, useMemo } from 'react';

import { ListRenderItem, useWindowDimensions } from 'react-native';

import {
  Box,
  CustomSkeleton,
  FlatList,
  Pressable,
  Skeleton,
  Typography,
} from '@onekeyhq/components';
import platformEnv from '@onekeyhq/shared/src/platformEnv';

const ListEmptyComponentRenderItem = () => {
  const { width } = useWindowDimensions();
  const screenWidth = width - 270 - 48;
  const minWidth = 250;
  const numColumns = Math.floor(screenWidth / minWidth);
  const cardWidth = screenWidth / numColumns;
  const data = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8], []);

  const renderItem: ListRenderItem<number> = useCallback(
    () => (
      <Box
        width={cardWidth}
        maxWidth={cardWidth}
        minWidth={cardWidth}
        height={156}
        paddingX="2"
        justifyContent="center"
        alignItems="center"
      >
        <Pressable
          bgColor="surface-default"
          flexDirection="column"
          borderRadius="12px"
          padding="4"
          width={cardWidth - 16}
          height={144}
          borderWidth={1}
          _hover={{ bgColor: 'surface-hovered' }}
          borderColor="border-subdued"
        >
          <Box flexDirection="row" mb="3">
            <Box w="12" h="12" overflow="hidden" borderRadius={12}>
              <CustomSkeleton />
            </Box>
            <Box ml="3">
              <Skeleton shape="Body1" />
              <Skeleton shape="Caption" />
            </Box>
          </Box>
          <Box h="4" w="full" mb="2" borderRadius={8} overflow="hidden">
            <CustomSkeleton />
          </Box>
          <Box h="3" w="80%" borderRadius={6} overflow="hidden">
            <CustomSkeleton />
          </Box>
        </Pressable>
      </Box>
    ),
    [cardWidth],
  );

  const flatList = useMemo(
    () => (
      <FlatList
        paddingLeft="24px"
        data={data}
        renderItem={renderItem}
        numColumns={numColumns}
        removeClippedSubviews
        windowSize={5}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => `${item}`}
        key={`key${numColumns}`}
        ItemSeparatorComponent={() => <Box h="3" />}
      />
    ),
    [data, numColumns, renderItem],
  );
  return (
    <Box width="100%">
      <Box mx="8">
        <Typography.Heading>Dapps</Typography.Heading>
      </Box>
      {flatList}
    </Box>
  );
};

export const EmptySkeleton = () => (
  <FlatList
    contentContainerStyle={{
      paddingBottom: 24,
      paddingTop: 24,
    }}
    data={[1, 2, 3, 4, 5, 6, 7, 8]}
    ListHeaderComponent={
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={platformEnv.isDesktop}
        contentContainerStyle={{
          paddingHorizontal: 16,
          marginBottom: 16,
        }}
        data={[1, 2, 3, 4, 5, 6, 7]}
        renderItem={() => (
          <Box h="7" w="12" borderRadius={12} mr={3} overflow="hidden">
            <CustomSkeleton />
          </Box>
        )}
      />
    }
    renderItem={() => <ListEmptyComponentRenderItem />}
    keyExtractor={(item) => String(item)}
    ItemSeparatorComponent={() => <Box h="8" />}
  />
);
