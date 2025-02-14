import { FC } from 'react';

import { useIntl } from 'react-intl';

import { Dialog } from '@onekeyhq/components';
import backgroundApiProxy from '@onekeyhq/kit/src/background/instance/backgroundApiProxy';
import { deviceUtils } from '@onekeyhq/kit/src/utils/hardware';
import { showOverlay } from '@onekeyhq/kit/src/utils/overlayUtils';

import HardwareLoadingDialog from '../Onekey/OnekeyHardwareConnectDialog';

type HandlerClosePassphraseViewProps = {
  deviceConnectId: string;
  onClose: () => void;
};

const HandlerClosePassphraseView: FC<HandlerClosePassphraseViewProps> = ({
  deviceConnectId,
  onClose,
}) => {
  const intl = useIntl();
  const { serviceHardware } = backgroundApiProxy;

  return (
    <Dialog
      visible
      onClose={onClose}
      contentProps={{
        title: intl.formatMessage({
          id: 'dialog__device_has_enabled_passphrase',
        }),
        content: intl.formatMessage({
          id: 'dialog__device_has_enabled_passphrase_desc',
        }),
        iconName: 'LockClosedSolid',
        iconType: 'success',
      }}
      footerButtonProps={{
        primaryActionTranslationId: 'action__disable',
        onSecondaryActionPress: () => onClose?.(),
        onPrimaryActionPress: () => {
          onClose?.();
          setTimeout(
            () =>
              showOverlay((onCloseOverlay) => (
                <HardwareLoadingDialog
                  onClose={onCloseOverlay}
                  onHandler={() =>
                    serviceHardware
                      .applySettings(deviceConnectId, {
                        usePassphrase: false,
                      })
                      .catch((e) => {
                        deviceUtils.showErrorToast(e);
                      })
                  }
                />
              )),
            100,
          );
        },
      }}
    />
  );
};

export default HandlerClosePassphraseView;
