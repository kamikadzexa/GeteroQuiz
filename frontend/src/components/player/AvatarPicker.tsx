import { useMemo, useState } from 'react'
import { useI18n } from '../../context/I18nContext'
import { api, assetUrl } from '../../services/api'

const presets = [
  'emoji:\u{1F389}',
  'emoji:\u{1FAA9}',
  'emoji:\u{1F680}',
  'emoji:\u{1F984}',
  'emoji:\u{1F3A7}',
  'emoji:\u{1F525}',
  'emoji:\u{1F31F}',
  'emoji:\u{1F308}',
  'emoji:\u{1F47E}',
  'emoji:\u{1F3B2}',
  'emoji:\u{1F43B}',
  'emoji:\u{1F99A}',
  'emoji:\u{1F981}',
  'emoji:\u{1F436}',
  'emoji:\u{1F431}',
  'emoji:\u{1F98A}',
  'emoji:\u{1F438}',
  'emoji:\u{1F98B}',
  'emoji:\u{1F42C}',
  'emoji:\u{1F9A5}',
  'emoji:\u{1F422}',
  'emoji:\u{1F47B}',
  'emoji:\u{1F916}',
  'emoji:\u{1F3AF}',
  'emoji:\u{1F3C6}',
  'emoji:\u{1F9E9}',
  'emoji:\u{1F4A1}',
]

export function AvatarPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  const visiblePresets = useMemo(() => {
    if (expanded) return presets

    const initial = presets.slice(0, 6)
    if (value.startsWith('emoji:') && !initial.includes(value) && presets.includes(value)) {
      return [...initial, value]
    }

    return initial
  }, [expanded, value])

  return (
    <div className="avatar-picker">
      <div className="avatar-grid">
        {visiblePresets.map((preset) => (
          <button
            key={preset}
            className={preset === value ? 'avatar-choice active' : 'avatar-choice'}
            onClick={() => onChange(preset)}
            type="button"
          >
            {preset.replace('emoji:', '')}
          </button>
        ))}
      </div>
      {presets.length > 6 ? (
        <button className="ghost-button avatar-toggle" onClick={() => setExpanded((current) => !current)} type="button">
          <span aria-hidden="true" className={expanded ? 'avatar-toggle-icon expanded' : 'avatar-toggle-icon'} />
          {expanded ? t('join.lessAvatars') : t('join.moreAvatars')}
        </button>
      ) : null}
      <label className="file-trigger">
        <input
          accept="image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return

            setUploading(true)
            setUploadProgress(0)
            try {
              const result = await api.uploadAvatar(file, setUploadProgress)
              onChange(result.url)
            } finally {
              setUploading(false)
              setUploadProgress(null)
              event.currentTarget.value = ''
            }
          }}
          type="file"
        />
        {uploading ? t('common.loading') : t('join.uploadImage')}
      </label>
      {uploadProgress !== null ? (
        <div className="upload-progress" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={uploadProgress}>
          <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
          <span>{uploadProgress}%</span>
        </div>
      ) : null}
      <div className="avatar-preview">
        {value.startsWith('emoji:') ? (
          <span className="avatar-large">{value.replace('emoji:', '')}</span>
        ) : (
          <img alt="Selected avatar" className="avatar-photo" src={assetUrl(value)} />
        )}
      </div>
    </div>
  )
}
