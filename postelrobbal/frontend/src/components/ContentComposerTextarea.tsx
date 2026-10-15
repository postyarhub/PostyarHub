import { useRef, useState } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { Textarea } from './ui';
import { StickerEmojiPicker } from './StickerEmojiPicker';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  toolsLabel?: string;
};

function insertAtSelection(field: HTMLTextAreaElement, value: string): void {
  if (!field.isConnected) return;
  field.focus();
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.setRangeText(value, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function ContentComposerTextarea({ toolsLabel = 'ایموجی و استیکر', ...props }: Props) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [stickerNote, setStickerNote] = useState('');
  const addValue = (value: string) => {
    const field = fieldRef.current;
    if (field) insertAtSelection(field, value);
  };

  return (
    <div className="content-composer" style={{ display: 'grid', gap: 8 }}>
      <Textarea ref={fieldRef} {...props} />
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <StickerEmojiPicker
          label={toolsLabel}
          onSelectEmoji={(emoji) => { setStickerNote(''); addValue(emoji); }}
          onSelectSticker={(sticker) => {
            if (sticker.emoji) { setStickerNote(''); addValue(sticker.emoji); }
            else setStickerNote('این استیکر نشانهٔ متنی ندارد؛ در ویرایشگر متنی، استیکر فقط با ایموجی همراه آن درج می‌شود.');
          }}
        />
      </div>
      {stickerNote ? <div className="sticker-picker-note" role="status">{stickerNote}</div> : null}
    </div>
  );
}
