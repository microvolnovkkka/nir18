package bot

import (
	"errors"
	"reflect"
	"testing"
)

func TestProtectedImagesUseASTAndExactSource(t *testing.T) {
	first := `![Схема](/media/30000000-0000-4000-8000-000000000001)`
	escaped := `![Точки \[пример\]](/media/30000000-0000-4000-8000-000000000002)`
	input := first + "\n\n" + first + "\n\n" + escaped + "\n\n```markdown\n" + first + "\n```\n\n`" + first + "`\n\n    " + first + "\n"
	got, err := ProtectedImages(input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{first, first, escaped}) {
		t.Fatalf("wrong images: %#v", got)
	}
	if err = ValidateOutputImages("report", first+"\n"+escaped, got); !errors.Is(err, ErrMediaMismatch) {
		t.Fatal("duplicate image loss not detected", err)
	}
	if err = ValidateOutputImages("report", escaped+"\n"+first+"\n"+first, got); err != nil {
		t.Fatal(err)
	}
	if err = ValidateOutputImages("clarification", "Уточните данные", got); err != nil {
		t.Fatal(err)
	}
	if err = ValidateOutputImages("clarification", first, got); !errors.Is(err, ErrMediaMismatch) {
		t.Fatal("clarification accepted image", err)
	}
}

func TestUnsupportedImagesFailClosed(t *testing.T) {
	for _, md := range []string{`![x](https://example.com/x.png)`, `![x](data:image/png;base64,AAAA)`, `<img src="x">`, "![x][ref]\n\n[ref]: /media/30000000-0000-4000-8000-000000000001", `![x](/media/30000000-0000-4000-8000-000000000001 "title")`} {
		if _, err := ProtectedImages(md); err == nil {
			t.Fatalf("accepted unsupported markup: %s", md)
		}
	}
}

func TestProtectedImagesCanonicalContexts(t *testing.T) {
	dest := "(/media/30000000-0000-4000-8000-000000000001)"
	for _, alt := range []string{"", "Схема", "**Схема**", "[подпись]", "`x]y`", "`x[y`", "``x`]y``", "` x]y `", "строка\nпродолжение", "`строка\n]продолжение`", "`x]" + dest + "y`"} {
		image := "![" + alt + "]" + dest
		for _, context := range []string{image, "Текст: " + image, "> " + image, "- " + image, "[" + image + "](https://example.com)"} {
			got, err := ProtectedImages(context)
			if err != nil || !reflect.DeepEqual(got, []string{image}) {
				t.Errorf("%q: images=%q err=%v", context, got, err)
			}
		}
	}
}
