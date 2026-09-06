import { Button, Modal } from '@/ui';

export interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Settings modal placeholder (task 0773 / feature A7).
 * Full settings persistence and configuration forms are deferred.
 */
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
    return (
        <Modal open={open} onClose={onClose} aria-labelledby="settings-modal-title">
            <div className="flex items-center justify-between pb-3 border-b border-spur-border">
                <h3 id="settings-modal-title" className="text-base font-semibold text-spur-text">
                    Settings
                </h3>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-spur-text-muted hover:text-spur-text"
                    onClick={onClose}
                    aria-label="Close settings"
                >
                    ✕
                </Button>
            </div>
            <div className="py-6 text-sm text-spur-text-muted">
                Settings configuration and workspace preferences will be available in a future release.
            </div>
        </Modal>
    );
}
