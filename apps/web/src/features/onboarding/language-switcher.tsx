import { LanguagesIcon } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { supportedLanguages } from "@/i18n"
import { languageLabelKey } from "./language-labels"
import { useLanguageSelection } from "./use-language-selection"

export function LanguageSwitcher() {
  const { t, language, pending, change } = useLanguageSelection()
  return (
    <Select
      value={language}
      onValueChange={(value) => void change(value)}
      disabled={pending}
    >
      <SelectTrigger
        size="sm"
        className="rounded-md"
        aria-label={t("settings.interfaceLanguage")}
        aria-busy={pending || undefined}
      >
        <LanguagesIcon aria-hidden="true" />
        <SelectValue>{t(languageLabelKey(language))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {supportedLanguages.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {t(languageLabelKey(locale))}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
