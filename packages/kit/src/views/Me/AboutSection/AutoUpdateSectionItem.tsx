import { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { useIntl } from 'react-intl';

import {
  Box,
  Icon,
  Pressable,
  Spinner,
  Switch,
  Text,
  useToast,
} from '@onekeyhq/components';
import backgroundApiProxy from '@onekeyhq/kit/src/background/instance/backgroundApiProxy';
import { useAutoUpdate, useSettings } from '@onekeyhq/kit/src/hooks/redux';
import {
  available,
  enable,
} from '@onekeyhq/kit/src/store/reducers/autoUpdater';
import { setUpdateSetting } from '@onekeyhq/kit/src/store/reducers/settings';
import appUpdates from '@onekeyhq/kit/src/utils/updates/AppUpdates';
import platformEnv from '@onekeyhq/shared/src/platformEnv';

import { DesktopVersion } from '../../../utils/updates/type';

const AutoUpdateSectionItem: FC = () => {
  const intl = useIntl();
  const toast = useToast();
  const { dispatch } = backgroundApiProxy;
  const { state, progress, latest } = useAutoUpdate();
  const { autoDownload = true } = useSettings().updateSetting ?? {};
  const [showAvailabelBadge, setShowAvailableBadge] = useState(true);

  const onCheckUpdate = useCallback(() => {
    appUpdates
      .checkUpdate(true)
      ?.then((version) => {
        if (!version) {
          toast.show({
            title: intl.formatMessage({
              id: 'msg__using_latest_release',
            }),
          });
        } else {
          dispatch(enable(), available(version));
        }
      })
      .catch(() => {})
      .finally(() => {});
  }, [dispatch, intl, toast]);

  useEffect(() => {
    if (platformEnv.isDesktop && state === 'available') {
      const { version = '0.0.0' } = (latest ?? {}) as DesktopVersion;
      if (appUpdates.skipVersionCheck(version)) {
        setShowAvailableBadge(false);
      }
    }
  }, [state, latest]);

  const onDownloadUpdate = useCallback(
    () => window.desktopApi?.downloadUpdate?.(),
    [],
  );

  const onInstallUpdate = useCallback(
    () => window.desktopApi?.installUpdate?.(),
    [],
  );

  const Content = useMemo(() => {
    if (platformEnv.isWeb || platformEnv.isExtension) {
      return null;
    }

    if (state === 'not-available' || state === 'checking') {
      return (
        <Pressable
          display="flex"
          flexDirection="row"
          alignItems="center"
          py={4}
          px={{ base: 4, md: 6 }}
          borderBottomWidth="1"
          borderBottomColor="divider"
          onPress={onCheckUpdate}
        >
          <Icon name="RefreshOutline" />
          <Text
            typography={{ sm: 'Body1Strong', md: 'Body2Strong' }}
            flex={1}
            mx={3}
          >
            {intl.formatMessage({
              id: 'form__check_for_updates',
            })}
          </Text>
          {state === 'checking' ? (
            <Spinner size="sm" />
          ) : (
            <Box>
              <Icon name="ChevronRightSolid" size={20} />
            </Box>
          )}
        </Pressable>
      );
    }

    if (state === 'available' || state === 'ready') {
      return (
        <Pressable
          display="flex"
          flexDirection="row"
          alignItems="center"
          py={4}
          px={{ base: 4, md: 6 }}
          borderBottomWidth="1"
          borderBottomColor="divider"
          onPress={() => {
            if (state === 'available') {
              if (platformEnv.isNative) {
                // Narrowing type to VersionInfo
                if (latest !== undefined && 'package' in latest) {
                  appUpdates.openAppUpdate(latest);
                }
              } else {
                onDownloadUpdate();
              }
            }
            if (state === 'ready') {
              onInstallUpdate();
            }
          }}
        >
          <Icon name="RefreshOutline" />
          <Text
            typography={{ sm: 'Body1Strong', md: 'Body2Strong' }}
            flex={1}
            mx={3}
          >
            {intl.formatMessage({
              id:
                state === 'available'
                  ? 'action__update_available'
                  : 'action__restart_n_update',
            })}
          </Text>
          {showAvailabelBadge && (
            <Box rounded="full" p="2px" pr="9px">
              <Box rounded="full" bgColor="interactive-default" size="8px" />
            </Box>
          )}
          <Box>
            <Icon name="ChevronRightSolid" size={20} />
          </Box>
        </Pressable>
      );
    }

    if (state === 'downloading') {
      return (
        <Pressable
          display="flex"
          flexDirection="row"
          alignItems="center"
          py={4}
          px={{ base: 4, md: 6 }}
          borderBottomWidth="1"
          borderBottomColor="divider"
          disabled
        >
          <Icon name="RefreshOutline" />
          <Text
            typography={{ sm: 'Body1Strong', md: 'Body2Strong' }}
            flex={1}
            mx={3}
          >
            {intl.formatMessage(
              { id: 'form__update_downloading' },
              {
                0: `${Math.floor(progress.percent)}%`,
              },
            )}
          </Text>
          <Box>
            <Icon name="ChevronRightSolid" size={20} />
          </Box>
        </Pressable>
      );
    }

    return null;
  }, [
    state,
    progress,
    intl,
    onCheckUpdate,
    onDownloadUpdate,
    onInstallUpdate,
    showAvailabelBadge,
    latest,
  ]);

  return (
    <>
      {Content}
      {platformEnv.isDesktop && (
        <Pressable
          display="flex"
          flexDirection="row"
          alignItems="center"
          py={4}
          px={{ base: 4, md: 6 }}
          borderBottomWidth="1"
          borderBottomColor="divider"
        >
          <Icon name="DownloadOutline" />
          <Text
            typography={{ sm: 'Body1Strong', md: 'Body2Strong' }}
            flex={1}
            mx={3}
          >
            {intl.formatMessage({ id: 'form__download_when_available' })}
          </Text>
          <Switch
            labelType="false"
            isChecked={autoDownload}
            onToggle={() =>
              dispatch(setUpdateSetting({ autoDownload: !autoDownload }))
            }
          />
        </Pressable>
      )}
    </>
  );
};

export default AutoUpdateSectionItem;
