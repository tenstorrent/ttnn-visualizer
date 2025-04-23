import { Button, ButtonVariant, Intent, MenuItem } from '@blueprintjs/core';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { useSession } from '../../hooks/useAPI';
import 'styles/components/FolderPicker.scss';

interface LocalFolderPickerProps {
    items: [];
    value: string | null;
    handleSelect: (folder: string) => void;
    handleDelete?: (folder: string) => void;
    defaultLabel?: string;
}

const LocalFolderPicker = ({
    items,
    value,
    handleSelect,
    handleDelete,
    defaultLabel = 'Select a report...',
}: LocalFolderPickerProps) => {
    const { data: session } = useSession();
    const isDisabled = !items || items.length === 0;

    const renderItem: ItemRenderer<string> = (folder, { handleClick, handleFocus, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            <div
                className='folder-picker-menu-item'
                key={folder}
            >
                <MenuItem
                    text={`/${folder}`}
                    roleStructure='listoption'
                    active={folder === value}
                    disabled={modifiers.disabled}
                    key={folder}
                    onClick={handleClick}
                    onFocus={handleFocus}
                    icon={modifiers.active ? IconNames.FOLDER_OPEN : IconNames.FOLDER_CLOSE}
                />

                {handleDelete && (
                    <Button
                        icon={IconNames.TRASH}
                        onClick={() => handleDelete(folder)}
                        variant={ButtonVariant.MINIMAL}
                        intent={Intent.DANGER}
                    />
                )}
            </div>
        );
    };

    return (
        <Select
            className='folder-picker'
            items={items ?? []}
            itemPredicate={(query, item) => !query || item.toLowerCase().includes(query.toLowerCase())}
            itemRenderer={renderItem}
            noResults={
                <MenuItem
                    disabled
                    text='No results.'
                    roleStructure='listoption'
                />
            }
            onItemSelect={handleSelect}
            disabled={!items || !session}
            fill
        >
            <Button
                className='folder-picker-button'
                text={value ? `/${value}` : defaultLabel}
                disabled={isDisabled || !session}
                alignText='start'
                icon={IconNames.FOLDER_OPEN}
                endIcon={IconNames.CARET_DOWN}
                variant={ButtonVariant.OUTLINED}
                fill
            />
        </Select>
    );
};

export default LocalFolderPicker;
