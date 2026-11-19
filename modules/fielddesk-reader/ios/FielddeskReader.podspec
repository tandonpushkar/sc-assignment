Pod::Spec.new do |s|
  s.name = 'FielddeskReader'
  s.version = '1.0.0'
  s.summary = 'Page and image preparation for Fielddesk OCR'
  s.description = s.summary
  s.homepage = 'https://expo.dev'
  s.license = 'UNLICENSED'
  s.author = 'Fielddesk'
  s.source = { :path => '.' }
  s.platforms = { :ios => '17.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.resource_bundles = { 'FielddeskOCR' => ['../resources/fielddesk-ocr/*'] }
end
