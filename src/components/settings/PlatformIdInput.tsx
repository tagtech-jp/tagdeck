"use client";

import { normalizePlatformId, type PlatformKind } from "@/lib/platforms/normalize-id";

interface Props {
  id: string;
  label?: string;
  platform: PlatformKind;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helpText: string;
  disabled?: boolean;
}

/**
 * 配信プラットフォームID入力の共通コンポーネント（R9 迷3対策）。
 * プロフィールURLの貼り付けを自動でID/ハンドルへ変換する以外の挙動は
 * 通常のテキスト入力と同じ。認証・保存ロジックは呼び出し側のまま変更しない。
 */
export function PlatformIdInput({
  id,
  label,
  platform,
  value,
  onChange,
  placeholder,
  helpText,
  disabled,
}: Props) {
  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(normalizePlatformId(e.target.value, platform))}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        className="min-h-11 w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      <p className="text-xs text-muted-foreground">{helpText}</p>
    </div>
  );
}
