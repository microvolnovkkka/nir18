package bot

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

var ErrMediaMismatch = errors.New("bot media mismatch")
var mediaDestination = regexp.MustCompile(`^/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ProtectedImages uses a CommonMark AST, so fenced/indented code and code spans
// do not count as images. The editor must normalize real images to inline
// ![alt](/media/uuid), without a title or reference-style destination.
// This function checks syntax only; ownership remains the website's responsibility.
func ProtectedImages(markdown string) ([]string, error) {
	source := []byte(markdown)
	doc := goldmark.New().Parser().Parse(text.NewReader(source))
	images := []string{}
	err := ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := node.(type) {
		case *ast.RawHTML, *ast.HTMLBlock:
			return ast.WalkStop, errors.New("raw HTML is not supported")
		case *ast.Image:
			if n.Reference != nil || len(n.Title) > 0 || !mediaDestination.Match(n.Destination) {
				return ast.WalkStop, errors.New("normalize images to inline /media/uuid")
			}
			for parent := n.Parent(); parent != nil; parent = parent.Parent() {
				if _, nested := parent.(*ast.Image); nested {
					return ast.WalkStop, errors.New("nested image")
				}
			}
			start := n.Pos()
			if start > 0 && source[start-1] == '!' {
				start--
			}
			if start < 0 || start+2 > len(source) || string(source[start:start+2]) != "![" {
				return ast.WalkStop, errors.New("image source position unavailable")
			}
			end, err := inlineImageEnd(source, start)
			if err != nil {
				return ast.WalkStop, err
			}
			raw := string(source[start:end])
			if !strings.HasSuffix(raw, "]("+string(n.Destination)+")") {
				return ast.WalkStop, errors.New("noncanonical image destination")
			}
			images = append(images, raw)
		}
		return ast.WalkContinue, nil
	})
	return images, err
}

func inlineImageEnd(source []byte, start int) (int, error) {
	depth := 1
	for i := start + 2; i < len(source); i++ {
		switch source[i] {
		case '\\':
			i++
		case '[':
			depth++
		case ']':
			depth--
			if depth != 0 {
				continue
			}
			if i+1 >= len(source) || source[i+1] != '(' {
				return 0, errors.New("reference image")
			}
			close := strings.IndexByte(string(source[i+2:]), ')')
			if close < 0 {
				return 0, errors.New("unclosed image")
			}
			return i + 2 + close + 1, nil
		}
	}
	return 0, errors.New("unclosed alt text")
}

func sameImages(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[string]int{}
	for _, s := range a {
		counts[s]++
	}
	for _, s := range b {
		counts[s]--
	}
	for _, n := range counts {
		if n != 0 {
			return false
		}
	}
	return true
}

func ValidateOutputImages(kind, markdown string, protected []string) error {
	actual, err := ProtectedImages(markdown)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrMediaMismatch, &Failure{Code: "invalid_response"})
	}
	expected := protected
	if kind == "clarification" {
		expected = nil
	}
	if !sameImages(actual, expected) {
		return fmt.Errorf("%w: %w", ErrMediaMismatch, &Failure{Code: "invalid_response"})
	}
	return nil
}
